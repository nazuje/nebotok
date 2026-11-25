import PDFKit
import AppKit
// Usage: swift render_booklet.swift <design-guide.pdf> <output-folder>
let args = CommandLine.arguments
let d = PDFDocument(url: URL(fileURLWithPath: args[1]))!
for i in 0..<d.pageCount {
  let p = d.page(at: i)!
  let b = p.bounds(for: .mediaBox)
  let scale: CGFloat = 4.0
  let w = Int(b.width * scale), h = Int(b.height * scale)
  let cs = CGColorSpaceCreateDeviceRGB()
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  p.draw(with: .mediaBox, to: ctx)
  let img = ctx.makeImage()!
  let rep = NSBitmapImageRep(cgImage: img)
  let data = rep.representation(using: .png, properties: [:])!
  try! data.write(to: URL(fileURLWithPath: args[2]).appendingPathComponent("page-\(i+1).png"))
}
print("ok")
