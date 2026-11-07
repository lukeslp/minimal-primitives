/*
 * Minimal Primitives for Android: an offline WebView shell around the browser
 * collection. The collection itself is never stored here. At build time the
 * collectionAssets task copies ../../build/html (made by tools/build.py) into
 * the APK's assets under www/.
 */

import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.util.Properties
import javax.inject.Inject
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val appProperties = Properties().apply {
    rootProject.file("app.properties").inputStream().use(::load)
}

fun appValue(name: String): String =
    requireNotNull(appProperties.getProperty(name)?.trim()?.takeIf(String::isNotEmpty)) {
        "android/app.properties must define $name"
    }

// Release signing comes only from the environment (or Gradle properties) of a
// single build. The minimal-primitives profile of android-release-toolkit
// supplies these four names from the Keychain:
//   scripts/android-release with-signing --profile minimal-primitives -- \
//     python3 /path/to/minimal-collection/tools/android.py --release
// A release build without all four stops with an error. It is never left
// unsigned and never falls back to the debug key.
fun privateValue(name: String): String? =
    providers.environmentVariable(name)
        .orElse(providers.gradleProperty(name))
        .orNull
        ?.takeIf(String::isNotBlank)

val releaseSigningNames = listOf(
    "MINIMAL_PRIMITIVES_RELEASE_STORE_FILE",
    "MINIMAL_PRIMITIVES_RELEASE_STORE_PASSWORD",
    "MINIMAL_PRIMITIVES_RELEASE_KEY_ALIAS",
    "MINIMAL_PRIMITIVES_RELEASE_KEY_PASSWORD",
)
val releaseStoreFile = privateValue(releaseSigningNames[0])
val releaseStorePassword = privateValue(releaseSigningNames[1])
val releaseKeyAlias = privateValue(releaseSigningNames[2])
val releaseKeyPassword = privateValue(releaseSigningNames[3])
val missingReleaseSigning = releaseSigningNames.filter { privateValue(it) == null }
val hasReleaseSigning = missingReleaseSigning.isEmpty()

android {
    // The Kotlin namespace is independent of the application id.
    namespace = "minimalprimitives.android"
    compileSdk = 36

    defaultConfig {
        applicationId = appValue("APPLICATION_ID")
        minSdk = 26
        targetSdk = 36
        versionCode = appValue("VERSION_CODE").toInt()
        versionName = appValue("VERSION_NAME")
    }

    buildFeatures {
        buildConfig = true
    }

    // full: the whole collection with camera input (the browser build, the
    // direct download). fdroid: the camera-free collection from
    // `python3 tools/build.py --variant fdroid`, with no CAMERA permission and
    // its own version, built unsigned for F-Droid's reproducible-build check and
    // signed afterwards with apksigner. Both keep the same application id.
    flavorDimensions += "build"
    productFlavors {
        create("full") {
            dimension = "build"
            buildConfigField("boolean", "CAMERA_INPUT", "true")
        }
        create("fdroid") {
            dimension = "build"
            versionCode = appValue("FDROID_VERSION_CODE").toInt()
            versionName = appValue("FDROID_VERSION_NAME")
            buildConfigField("boolean", "CAMERA_INPUT", "false")
        }
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(requireNotNull(releaseStoreFile))
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        release {
            isDebuggable = false
            // Gradle's root is android/, below the repository's .git, so this
            // file would only say NO_SUPPORTED_VCS_FOUND; leaving it out keeps
            // release bytes independent of how the source was checked out.
            vcsInfo.include = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // F-Droid's scanner rejects the Play dependency-metadata signing block.
    dependenciesInfo {
        includeInApk = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // Adaptive icons must sit in a v26 folder even though 26 is the minimum.
        disable += "ObsoleteSdkInt"
        // Dependency versions are pinned deliberately and updated by hand.
        disable += "GradleDependency"
        disable += "AndroidGradlePluginVersion"
        disable += "NewerVersionAvailable"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    testImplementation("junit:junit:4.13.2")
}

/**
 * Copies the browser build into the APK. The copy is exact except that
 * settings.json is forced to keep scores on the device: the app has no
 * network permission, so a configured score service could never be reached.
 */
abstract class CollectionAssets : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val collection: DirectoryProperty

    @get:OutputDirectory
    abstract val outputDir: DirectoryProperty

    @get:Inject
    abstract val files: FileSystemOperations

    @TaskAction
    fun copy() {
        val source = collection.get().asFile
        for (name in listOf("index.html", "catalog.json", "settings.json", "collection.js")) {
            check(source.resolve(name).isFile) {
                "${source.resolve(name)} is missing. Build with: python3 tools/android.py " +
                    "(add --fdroid for the camera-free collection)"
            }
        }
        val www = outputDir.get().dir("www").asFile
        files.sync {
            from(source)
            into(www)
        }
        val settings = www.resolve("settings.json")
        @Suppress("UNCHECKED_CAST")
        val values = JsonSlurper().parse(settings) as MutableMap<String, Any?>
        if (values["apiBase"] != "") {
            values["apiBase"] = ""
            settings.writeText(JsonOutput.toJson(values) + "\n")
            logger.lifecycle("collectionAssets: apiBase cleared; scores stay on the device.")
        }
    }
}

// Each flavor plays its own browser build: build/html (full) or build/html-fdroid.
val collectionAssetsFull = tasks.register<CollectionAssets>("collectionAssetsFull") {
    collection.set(rootProject.layout.projectDirectory.dir("../build/html"))
}
val collectionAssetsFdroid = tasks.register<CollectionAssets>("collectionAssetsFdroid") {
    collection.set(rootProject.layout.projectDirectory.dir("../build/html-fdroid"))
}

androidComponents {
    onVariants { variant ->
        val assets = if (variant.flavorName == "fdroid") collectionAssetsFdroid else collectionAssetsFull
        variant.sources.assets?.addGeneratedSourceDirectory(assets, CollectionAssets::outputDir)
    }
}

/**
 * Stops a full release build that lacks the release identity before anything
 * compiles, so no unsigned or debug-signed full release package is made. The
 * fdroid release is meant to be unsigned: F-Droid rebuilds it from source, and
 * the upstream signature is added afterwards with apksigner.
 */
abstract class RequireReleaseSigning : DefaultTask() {
    @get:Input
    abstract val missing: ListProperty<String>

    @get:Internal
    abstract val storeFile: Property<String>

    @TaskAction
    fun check() {
        val absent = missing.get()
        if (absent.isNotEmpty()) {
            throw GradleException(
                "Release signing is not configured: ${absent.joinToString()} " +
                    "${if (absent.size == 1) "is" else "are"} missing. A release build must " +
                    "be signed with the Minimal Primitives release key. From " +
                    "android-release-toolkit run: scripts/android-release with-signing " +
                    "--profile minimal-primitives -- python3 " +
                    "/path/to/minimal-collection/tools/android.py --release. " +
                    "For a debug test build, run python3 tools/android.py instead."
            )
        }
        val store = File(storeFile.get())
        if (!store.isFile) {
            throw GradleException("The release keystore named for signing does not exist: $store")
        }
    }
}

val requireReleaseSigning = tasks.register<RequireReleaseSigning>("requireReleaseSigning") {
    missing.set(missingReleaseSigning)
    releaseStoreFile?.let { storeFile.set(it) }
}

tasks.matching { it.name == "preFullReleaseBuild" }.configureEach {
    dependsOn(requireReleaseSigning)
}
