#!/usr/bin/env python3
"""Build the Minimal Primitives Android app from the browser collection.

The app plays exactly what tools/build.py produces. This script runs that build,
then Gradle, whose collectionAssets task copies build/html into the APK. Games
and the collection shell are never edited for Android.

    python3 tools/android.py            debug-signed APK for testing
    python3 tools/android.py --lint     the same, plus Android lint
    python3 tools/android.py --release  release APK and AAB, signed with the
                                        release key; run it through the
                                        toolkit's with-signing (see below)
    python3 tools/android.py --icons    redraw launcher icons from the tile art
                                        (needs Pillow; not part of a normal build)
    python3 tools/android.py --fdroid [--release]
                                        the camera-free fdroid flavor (from
                                        tools/build.py --variant fdroid); its
                                        release APK is unsigned, for F-Droid's
                                        reproducible-build check

The finished APK is copied to build/android/ with its size and SHA-256 printed.

A release build needs the four MINIMAL_PRIMITIVES_RELEASE_* values, which
android-release-toolkit supplies from the Keychain for this one process:

    scripts/android-release with-signing --profile minimal-primitives -- \
        python3 /path/to/minimal-collection/tools/android.py --release

Without them it stops before building anything; it never makes an unsigned or
debug-signed release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / 'android'
OUTPUT = ROOT / 'build' / 'android'
ICON_ART = ROOT / 'web' / 'assets' / 'hexsweeper-sphere.png'
ICON_DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
ICON_SPHERE_DP = 60  # inside the 66dp adaptive-icon safe zone of a 108dp layer
# Gradle 8.14 runs on JDK 17 to 24; the Android Gradle Plugin needs 17 or newer.
SUPPORTED_JDKS = range(17, 25)
RELEASE_SIGNING = (
    'MINIMAL_PRIMITIVES_RELEASE_STORE_FILE',
    'MINIMAL_PRIMITIVES_RELEASE_STORE_PASSWORD',
    'MINIMAL_PRIMITIVES_RELEASE_KEY_ALIAS',
    'MINIMAL_PRIMITIVES_RELEASE_KEY_PASSWORD',
)
# A signed build runs in a single-use Gradle process with the configuration
# cache off and Kotlin compiled in that process, so the signing values are
# never written to Gradle's on-disk caches or left in a long-lived daemon.
RELEASE_GRADLE_FLAGS = (
    '--no-daemon',
    '--no-configuration-cache',
    '-Pkotlin.compiler.execution.strategy=in-process',
)


def app_properties():
    values = {}
    for line in (ANDROID / 'app.properties').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip()
    for key in ('APPLICATION_ID', 'VERSION_NAME', 'VERSION_CODE'):
        if not values.get(key):
            sys.exit(f'android/app.properties must define {key}')
    return values


def jdk_major(home):
    release = Path(home) / 'release'
    if not release.is_file():
        return None
    match = re.search(r'^JAVA_VERSION="(\d+)(?:\.(\d+))?', release.read_text(), re.M)
    if not match:
        return None
    major = int(match.group(1))
    return int(match.group(2) or 0) if major == 1 else major


def find_jdk():
    candidates = []
    if os.environ.get('JAVA_HOME'):
        candidates.append(os.environ['JAVA_HOME'])
    if platform.system() == 'Darwin':
        for version in ('21', '17'):
            found = subprocess.run(['/usr/libexec/java_home', '-v', version],
                                   capture_output=True, text=True)
            if found.returncode == 0:
                candidates.append(found.stdout.strip())
        candidates.append('/Applications/Android Studio.app/Contents/jbr/Contents/Home')
    for home in candidates:
        if jdk_major(home) in SUPPORTED_JDKS:
            return home
    sys.exit('No JDK 17 to 24 found. Install JDK 21 or set JAVA_HOME to one.')


def find_sdk():
    for home in (os.environ.get('ANDROID_HOME'), os.environ.get('ANDROID_SDK_ROOT'),
                 Path.home() / 'Library/Android/sdk', Path.home() / 'Android/Sdk'):
        if home and (Path(home) / 'platforms').is_dir():
            return str(home)
    sys.exit('No Android SDK found. Set ANDROID_HOME.')


def build_collection(variant='full'):
    subprocess.run([sys.executable, str(ROOT / 'tools' / 'build.py'), '--variant', variant, *(['--no-zip'] if variant != 'full' else [])], check=True)
    html = ROOT / 'build' / ('html' if variant == 'full' else 'html-' + variant)
    catalog = json.loads((html / 'catalog.json').read_text())
    settings = json.loads((html / 'settings.json').read_text())
    tiles = sum(max(1, len(game.get('modes', []))) for game in catalog)
    print(f'Collection: {len(catalog)} games, {tiles} library tiles.')
    if settings.get('apiBase'):
        print('The browser build names a score service; the Android copy clears it, '
              'so scores stay on the device.')


def require_release_signing():
    missing = [name for name in RELEASE_SIGNING if not os.environ.get(name, '').strip()]
    if missing:
        sys.exit('Release signing is not configured: ' + ', '.join(missing)
                 + (' is' if len(missing) == 1 else ' are') + ' missing. Build the release with\n'
                 '  scripts/android-release with-signing --profile minimal-primitives -- '
                 f'python3 {Path(__file__).resolve()} --release\n'
                 'from android-release-toolkit. For a debug test build, leave out --release.')
    if not Path(os.environ[RELEASE_SIGNING[0]]).is_file():
        sys.exit('The release keystore named for signing does not exist.')


def gradle(tasks, flags=(), unsigned=False):
    env = dict(os.environ, JAVA_HOME=find_jdk(), ANDROID_HOME=find_sdk())
    env.pop('ANDROID_SDK_ROOT', None)
    if unsigned:
        for name in RELEASE_SIGNING:
            env.pop(name, None)
    command = [str(ANDROID / ('gradlew.bat' if os.name == 'nt' else 'gradlew')), *flags, *tasks]
    print('JDK:', env['JAVA_HOME'])
    subprocess.run(command, cwd=ANDROID, env=env, check=True)


def stage(source, label, app, prefix=''):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    dest = OUTPUT / f"minimal-primitives-{app[prefix + 'VERSION_NAME']}-{app[prefix + 'VERSION_CODE']}-{label}{source.suffix}"
    shutil.copyfile(source, dest)
    digest = hashlib.sha256(dest.read_bytes()).hexdigest()
    print(f'{dest}: {dest.stat().st_size:,} bytes, SHA256 {digest}')
    return dest


def draw_icons():
    """Make the launcher layers from the Hexsweeper Sphere tile.

    The tile's black line work becomes an alpha mask: dark ink on the white
    paper background for the icon, white for the monochrome and splash layer.
    The lines are thickened by one pixel so they survive launcher sizes.
    """
    from PIL import Image, ImageFilter, ImageOps

    art = Image.open(ICON_ART).convert('L').filter(ImageFilter.MinFilter(3))
    ink = ImageOps.invert(art)
    sphere = ink.crop(ink.getbbox())
    for density, scale in ICON_DENSITIES.items():
        size = round(108 * scale)
        width = round(ICON_SPHERE_DP * scale)
        height = round(width * sphere.height / sphere.width)
        mask = Image.new('L', (size, size), 0)
        mask.paste(sphere.resize((width, height), Image.LANCZOS),
                   ((size - width) // 2, (size - height) // 2))
        folder = ANDROID / 'app/src/main/res' / f'mipmap-{density}'
        folder.mkdir(parents=True, exist_ok=True)
        for name, colour in (('ic_launcher_foreground', (17, 17, 17)),
                             ('ic_launcher_monochrome', (255, 255, 255))):
            layer = Image.new('RGBA', (size, size), colour + (0,))
            layer.putalpha(mask)
            layer.save(folder / f'{name}.png', optimize=True)
            print(folder / f'{name}.png')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--release', action='store_true', help='build release APK and AAB')
    parser.add_argument('--lint', action='store_true', help='also run Android lint')
    parser.add_argument('--icons', action='store_true', help='redraw launcher icons and stop')
    parser.add_argument('--fdroid', action='store_true', help='build the camera-free fdroid flavor')
    args = parser.parse_args()
    if args.icons:
        draw_icons()
        return
    app = app_properties()
    outputs = ANDROID / 'app' / 'build' / 'outputs'
    if args.fdroid:
        for key in ('FDROID_VERSION_NAME', 'FDROID_VERSION_CODE'):
            if not app.get(key):
                sys.exit(f'android/app.properties must define {key}')
        build_collection('fdroid')
        if args.release:
            # Unsigned on purpose: F-Droid rebuilds it and compares; the upstream
            # signature is copied on afterwards with apksigner.
            gradle(['testFdroidReleaseUnitTest', 'lintFdroidRelease', 'assembleFdroidRelease'],
                   RELEASE_GRADLE_FLAGS, unsigned=True)
            stage(outputs / 'apk/fdroid/release/app-fdroid-release-unsigned.apk', 'fdroid-unsigned', app, 'FDROID_')
        else:
            gradle(['testFdroidDebugUnitTest', *(['lintFdroidDebug'] if args.lint else []), 'assembleFdroidDebug'])
            stage(outputs / 'apk/fdroid/debug/app-fdroid-debug.apk', 'fdroid-debug', app, 'FDROID_')
        print(f"{app['APPLICATION_ID']} {app['FDROID_VERSION_NAME']} ({app['FDROID_VERSION_CODE']}), fdroid flavor")
        return
    if args.release:
        require_release_signing()
    build_collection()
    if args.release:
        signed = outputs / 'apk/full/release/app-full-release.apk'
        gradle(['testFullReleaseUnitTest', 'lintFullRelease', 'assembleFullRelease', 'bundleFullRelease'],
               RELEASE_GRADLE_FLAGS)
        if not signed.is_file():
            sys.exit(f'Gradle did not produce a signed release APK at {signed}.')
        stage(signed, 'release', app)
        stage(outputs / 'bundle/fullRelease/app-full-release.aab', 'release', app)
    else:
        gradle(['testFullDebugUnitTest', *(['lintFullDebug'] if args.lint else []), 'assembleFullDebug'])
        stage(outputs / 'apk/full/debug/app-full-debug.apk', 'debug', app)
    print(f"{app['APPLICATION_ID']} {app['VERSION_NAME']} ({app['VERSION_CODE']})")


if __name__ == '__main__':
    main()
