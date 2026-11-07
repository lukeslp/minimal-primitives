// Draws the iOS app icon and launch image from the Hexsweeper Sphere tile,
// the same artwork the Android launcher uses. By Luke Steuber.
//   swift ios/tools/draw-icons.swift   (from the repository root)
// The icon is the tile's black line work on white paper, lines thickened by
// one pixel so they survive small sizes; the launch image is the same sphere
// in white on the library's dark ground (#111111), transparent around it.
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

let tile = URL(fileURLWithPath: "web/assets/hexsweeper-sphere.png")
let assets = URL(fileURLWithPath: "ios/MinimalPrimitives/Assets.xcassets")
let context = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
guard let source = CIImage(contentsOf: tile) else { fatalError("missing \(tile.path)") }

// Thicken the ink: a minimum over 3x3 grows dark lines on light paper.
let thick = source.applyingFilter("CIMorphologyMinimum", parameters: ["inputRadius": 1.0]).cropped(to: source.extent)

func write(_ image: CIImage, size: CGFloat, to url: URL, opaque: Bool) {
    let scale = size / image.extent.width
    let scaled = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale)).cropped(to: CGRect(x: 0, y: 0, width: size, height: size))
    let cg = context.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: size, height: size), format: opaque ? .RGBA8 : .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)!
    var final = cg
    if opaque, let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) {
        ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: size, height: size)); final = ctx.makeImage()!
    }
    try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, final, nil); CGImageDestinationFinalize(dest)
    print(url.path)
}

// Icon: opaque, black on white, the full tile (the sphere fills about two thirds).
write(thick, size: 1024, to: assets.appendingPathComponent("AppIcon.appiconset/icon-1024.png"), opaque: true)

// Launch: white lines with transparent paper, shown on the dark launch color.
let white = thick.applyingFilter("CIColorInvert").applyingFilter("CIMaskToAlpha")
write(white, size: 600, to: assets.appendingPathComponent("LaunchSphere.imageset/launch-sphere.png"), opaque: false)
