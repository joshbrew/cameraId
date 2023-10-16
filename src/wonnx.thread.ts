import init, { main, Session, Input } from "@webonnx/wonnx-wasm";

import {initWorker} from 'threadop'

//@ts-ignore
if(globalThis instanceof WorkerGlobalScope) {

    //files go in ./models
    const modelName = 'opt-squeeze.onnx'; //'inception_mnist.onnx' //'single_relu.onnx' //todo: make configurable
    const labelsName = 'squeeze-labels.txt'; //'mnist-labels.txt'

    //input and output variables, input is Float32Array, output is array or something
    const inputName = 'data';
    const resultName = 'squeezenet0_flatten0_reshape0';


    const squeezeWidth = 224;
    const squeezeHeight = 224;

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
            height:number
        }) {

            console.log(data);
            if(!data) return;
            const imageData = new ImageData(data.width,data.height);
            const imageTransformed = new Float32Array(squeezeWidth * squeezeHeight * 3);
            imageData.data.set(data.image);

            //this doesn't seem right but this was the official example.
            for (let plane = 0; plane < planes; plane++) {
                for (let y = 0; y < squeezeHeight; y++) {
                    for (let x = 0; x < squeezeWidth; x++) {
                        const v = imageData.data[y * squeezeWidth * valuesPerPixel + x * valuesPerPixel + plane] / 255.0;
                        imageTransformed[plane * (squeezeWidth * squeezeHeight) + y * squeezeWidth + x] = (v - mean[plane]) / std[plane];
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
            const probs = result.get(resultName);
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

            //report back to main thread
            return { 
                probs, 
                maxProb, 
                label:labelsList[maxIndex],
                avgTimeMs:avgFrameTime,
                name:data.name,
                width:data.width,
                height:data.height
            };
        }
        
        initWorker(classifyImage); //do this ASAP
        
        
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
    
    initClassifier();
}

//this is a hack for importing with tinybuild
export default self as any;