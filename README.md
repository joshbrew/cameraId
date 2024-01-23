## WONNX Camera & Bounding Box Real-Time Classification Demo

### [Live Demo](https://wonnx-cameraid.netlify.app/)

Copy of the official [wonnx wasm](https://github.com/webonnx/wonnx) squeeze net [example](https://github.com/webonnx/wonnx-wasm-example) with a test for multithreading the video codec so I can store recent data in memory and draw image copies to canvases or send to the classifier or do other things. 

You can use capacitor to compile to mobile, we're working on it.

Inference time for the 1000 label squeeze-net averages about 6-10ms for me on an RTX 3070, whatever that means. I tested on a 4K camera but the squeeze net uses only like a small square of the image. Switching over to an MNIST example next.

I'm getting about 120fps-135FPS on just the WONNX pass. It's not actually 120FPS with the full demo because we're rendering a bunch of offscreen canvases same time and doing image processing which is not ideal in JS but it's still fairly fast, and otherwise throttles itself based on worker load. This is also with a 1080p youtube video in another tab. 

# build and run
`npm i -g tinybuild` then `npm start`

Note, these labels don't include the right species:
![Capture](./screenshot.PNG)

# Mobile Build

For android with the capacitor dependencies installed and the latest android studio installation:

`npx cap sync`

`npx cap open android`

or for ios

`npx cap add ios`

then 

`npx cap sync`

`npx cap open ios`

Note the dist has copies necessary for the mobile build to run e.g. the ./dist/models and ./dist/dist to keep the same relative paths as the webapp. This should be cleaned up for production to prevent bloat for the served app.