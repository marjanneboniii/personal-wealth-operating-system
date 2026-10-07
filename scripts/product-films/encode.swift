// Encode deterministic PNG frames to an H.264 MP4, with fast-start metadata.
// Usage: swift encode.swift frames-directory output.mp4 width height fps duration
import Foundation
import AVFoundation
import AppKit
import CoreVideo

let frames = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let width = Int(CommandLine.arguments[3])!
let height = Int(CommandLine.arguments[4])!
let fps = Int32(CommandLine.arguments[5])!
let duration = Int(CommandLine.arguments[6])!
let files = try FileManager.default.contentsOfDirectory(at: frames, includingPropertiesForKeys: nil).filter { $0.pathExtension == "png" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
guard files.count == Int(fps) * duration else { fatalError("Expected a complete \(duration)-second film; got \(files.count) frames") }
if FileManager.default.fileExists(atPath: output.path) { try FileManager.default.removeItem(at: output) }
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
writer.shouldOptimizeForNetworkUse = true
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
 AVVideoCodecKey: AVVideoCodecType.h264,
 AVVideoWidthKey: width, AVVideoHeightKey: height,
 AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1800000, AVVideoMaxKeyFrameIntervalKey: Int(fps)*2, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]
])
input.expectsMediaDataInRealTime = false
let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true])
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error!.localizedDescription) }
writer.startSession(atSourceTime: .zero)
for (index, file) in files.enumerated() {
 while !input.isReadyForMoreMediaData { if writer.status == .failed { fatalError(writer.error!.localizedDescription) }; Thread.sleep(forTimeInterval: 0.002) }
 try autoreleasepool {
  let source = CGImageSourceCreateWithURL(file as CFURL, nil)!
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)!
  var pixel: CVPixelBuffer?
  guard CVPixelBufferPoolCreatePixelBuffer(nil, adapter.pixelBufferPool!, &pixel) == kCVReturnSuccess else { fatalError("Pixel allocation failed") }
  let buffer = pixel!
  CVPixelBufferLockBaseAddress(buffer, [])
  let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  CVPixelBufferUnlockBaseAddress(buffer, [])
  if !adapter.append(buffer, withPresentationTime: CMTime(value: Int64(index), timescale: fps)) { throw writer.error ?? NSError(domain:"FilmEncoder",code:1) }
 }
 if index % (Int(fps)*10) == 0 { print("Encoded \(index)/\(files.count) frames") }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Encoding failed") }
print("Completed: \(output.path)")
