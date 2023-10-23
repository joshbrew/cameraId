import init, { main, Session, Input } from "@webonnx/wonnx-wasm";

import {initWorker} from 'threadop'

//@ts-ignore
if(globalThis instanceof WorkerGlobalScope) {

    //files go in ./models
    let modelName = 'inception-mnist.onnx'; //'opt-squeeze.onnx' //'inception_mnist.onnx' //'single_relu.onnx' //todo: make configurable
    let labelsName = 'mnist-labels.txt'; //'mnist-labels.txt' //'squeeze-labels.txt'

    //input and output variables, input is Float32Array, output is array or something
    let inputName = 'input'; //'data'
    let outputName = 'output'; //'output'


    let outputWidth = 64;
    let outputHeight = 64;

    let inferenceCount = 0;
    let inferenceTime = 0;
    // Transform the image data in the format expected by SqueezeNet
    const planes = 3; // SqueezeNet expects RGB
    const valuesPerPixel = 4; // source data is RGBA
    let mean = [0.485, 0.456, 0.406];
    let std = [0.229, 0.224, 0.225];

    const initClassifier = async () => {


        let session:Session, labelsList:string[];

        async function classifyImage(data:{
            image:Uint8ClampedArray,
            name:any,
            type:any,
            width:number,
            height:number,
            timestamp:number,
            command?:'configure',
            modelName?:string, //in models/
            labelsName?:string, //in models/
            inputName?:string, //input onnx name, todo multiple i/o via a dict
            outputName?:string, //output onnx variable name,
            outputWidth?:number, //set image parameters
            outputHeight?:number
        }) {

            if(data.command) {
                if(data.command === 'configure') {
                    if(data.modelName)      modelName = data.modelName;
                    if(data.labelsName)     labelsName = data.labelsName;
                    if(data.outputName)     outputName = data.outputName;
                    if(data.inputName)      inputName = data.inputName;
                    if(data.outputWidth)    outputWidth = data.outputWidth;
                    if(data.outputHeight)   outputHeight = data.outputHeight;

                    async function fetchBytes(url) {
                        const reply = await fetch(url);
                        const blob = await reply.arrayBuffer();
                        const arr = new Uint8Array(blob);
                        return arr;
                    }
                
                    // Load model, labels file and WONNX
                    const [
                        modelBytes, 
                        initResult, 
                        labelsResult
                    ] = await Promise.all([
                        fetchBytes(location.origin+"/models/"+modelName), 
                        init(), 
                        fetch(location.origin+"/models/"+labelsName).then(r => r.text())
                    ]);
            
                    //console.log(modelBytes, initResult, labelsResult)
            
                    console.log("Initialized", { modelBytes, initResult, Session, labelsResult});
                    // Start inference session
                    session = await Session.fromBytes(modelBytes);
            
                    // Parse labels
                    labelsList = labelsResult.split(/\n/g);
            
            
                }
                return;
            }

            if(!data) return;
            const imageData = new ImageData(data.image, data.width,data.height);
            const imageTransformed = new Float32Array(outputWidth * outputHeight * 3);

            //this doesn't seem right but this was the official example.
            for (let plane = 0; plane < planes; plane++) {
                for (let y = 0; y < outputHeight; y++) {
                    for (let x = 0; x < outputWidth; x++) {
                        const v = imageData.data[y * outputWidth * valuesPerPixel + x * valuesPerPixel + plane] / 255.0;
                        imageTransformed[plane * (outputWidth * outputHeight) + y * outputWidth + x] = (v - mean[plane]) / std[plane];
                    }
                }
            }

            // Start inference
            const input = new Input();
            input.insert(inputName, imageTransformed);
            const start = performance.now();
            const result = await session.run(input);
            const duration = performance.now() - start;
            inferenceCount++;
            inferenceTime += duration;
            input.free();

            // Find the label with the highest probability
            const probs = result.get(outputName);
            
            let maxProb = -1;
            let maxIndex = -1;
            for (let index = 0; index < probs.length; index++) {
                const p = probs[index];
                if (p > maxProb) {
                    maxProb = p;
                    maxIndex = index;
                }
            }

            const avgFrameTime = inferenceTime / inferenceCount;
            const avgFrameRate = inferenceCount / (inferenceTime*0.001);

            //report back to main thread
            return { 
                probs, 
                maxProb, 
                label:labelsList[maxIndex],
                inferenceTime:duration,
                avgFrameTime,
                avgFrameRate,
                name:data.name,
                width:data.width,
                height:data.height
            };
        }
        
        initWorker(classifyImage); //do this ASAP
        
        


    }
    
    initClassifier();
}

//this is a hack for importing with tinybuild
export default self as any;