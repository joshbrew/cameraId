Copy of the official [wonnx wasm](https://github.com/webonnx/wonnx) squeeze net [example](https://github.com/webonnx/wonnx-wasm-example) with a test for multithreading the video codec so I can store recent data in memory and draw image copies to canvases or send to the classifier or do other things. 

It uses the capacitor community CameraPreview API for mobile camera access but the rest is vanilla JS, though the mobile app isn't set up yet with the special permissions and build step requirements. This repo will evolve.

Inference time for the 1000 label squeeze-net averages about 8-10ms for me on an RTX 3070, whatever that means.

# build and run
`npm i -g tinybuild` then `npm start`

