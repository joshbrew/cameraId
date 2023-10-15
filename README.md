Copy of the official [wonnx wasm](https://github.com/webonnx/wonnx) squeeze net [example](https://github.com/webonnx/wonnx-wasm-example) with a test for multithreading the video codec so I can store recent data in memory and draw image copies to canvases or send to the classifier or do other things. The video buffering into the classifier is buggy right now just FYI or if you click too fast on "take picture," just because of the way we did the threading, but we're sorting it. 

It uses the capacitor community CameraPreview API for mobile camera access but the rest is vanilla JS, though the mobile app isn't set up yet with the special permissions and build step requirements. This repo will evolve.

Inference time for the 1000 label squeeze-net averages about 6-10ms for me on an RTX 3070, whatever that means. I tested on a 4K camera but the squeeze net uses only like a small square of the image. Switching over to an MNIST example next.

# build and run
`npm i -g tinybuild` then `npm start`

