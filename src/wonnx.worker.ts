//import init, { main, Session, Input } from "@webonnx/wonnx-wasm";

import * as ort from 'onnxruntime-web'
import * as wgpuort from 'onnxruntime-web/webgpu'
//import * as wglort from 'onnxruntime-web/webgpu'

import { convertRGBAToRGBPlanarNormalized, convertRGBAtoRGBFloat32 } from "./lib/imagemanip"
import {initWorker} from 'threadop'

//@ts-ignore
if(typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {


    // Example usage
    // const rgbaData = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    // const rgbData = convertRGBAtoRGBFloat32(rgbaData);
    // console.log(rgbData);  // Float32Array(6) [1, 0, 0, 0, 1, 0]
      
    // utility function, creates array of numbers from `start` to `stop`, with given `step`:
    const range = (start, stop, step = 1) =>
        Array(Math.ceil((stop - start) / step)).fill(start).map((x, y) => x + y * step)

    //files go in ./models
    let modelName = 'inception-mnist.onnx'; //'opt-squeeze.onnx' //'inception_mnist.onnx' //'single_relu.onnx' //todo: make configurable
    let labelsName = 'mnist-labels.txt'; //'mnist-labels.txt' //'squeeze-labels.txt'

    //input and output variables, input is Float32Array, output is array or something
    let inputName = 'input'; //'data'
    let outputName = 'output'; //'output'

    let outputWidth = 224; //64
    let outputHeight = 224; //64

    let inferenceCount = 0;
    let inferenceTime = 0;
    // Transform the image data in the format expected by SqueezeNet

    const initClassifier = async () => {


        let session:ort.InferenceSession, labelsList:string[];

        //thread callback
        async function classifyImage(data:{
            image?:Uint8ClampedArray,
            spectral?:{
                intensities:{r:number,g:number,b:number,i:number}[],
                maxR:number,maxG:number,maxB:number,
                width:number,
                height:number
            },
            input?:'imageflattened'|'spectral'|'image',

            name:string, id:string,
            type:string,
            width:number,
            height:number,
            timestamp:number,
            cropIndex:number,

            command?:'configure',
            modelName?:string, //in models/
            model?:any, //model data buffer
            labelsName?:string, //in models/
            labels?:any, //label data buffer
            inputName?:string, //input onnx name, todo multiple i/o via a dict
            outputName?:string, //output onnx variable name,
            outputWidth?:number, //set image parameters
            outputHeight?:number
        }) {
            //console.log('wonnx input', data);
            if(data.command === 'configure') {
                if(data.modelName)      modelName = data.modelName;
                if(data.labelsName)     labelsName = data.labelsName;
                if(data.outputName)     outputName = data.outputName;
                if(data.inputName)      inputName = data.inputName;
                if(data.outputWidth)    outputWidth = data.outputWidth;
                if(data.outputHeight)   outputHeight = data.outputHeight;

                // async function fetchBytes(url) {
                //     const reply = await fetch(url);
                //     const blob = await reply.arrayBuffer();
                //     const arr = new Uint8Array(blob);
                //     return arr;
                // }
            
                // // Load model, labels file and WONNX
                // const [
                //     modelBytes, 
                //     initResult, 
                //     labelsResult
                // ] = await Promise.all([
                //     data.model ? data.model : fetchBytes(location.origin+"/models/"+modelName), 
                //     init(), 
                //     data.labels ? data.labels : fetch(location.origin+"/models/"+labelsName).then(r => r.text())
                // ]);
        
                // //console.log(modelBytes, initResult, labelsResult)
        
                // console.log("Initialized", { modelBytes, initResult, Session, labelsResult});
                // // Start inference session
                // session = await Session.fromBytes(modelBytes);
        

                //https://github.com/microsoft/onnxruntime-inference-examples/tree/main/js/api-usage_session-options
                try{ //WebGPU
                    session = await wgpuort.InferenceSession.create(location.origin+"/models/"+modelName, {
                        executionProviders: ['webgpu'] //'wasm' 'webgl' 'webgpu'
                    });
                    console.log("Created WebGPU ONNX session");
                } catch(er) {
                    console.error("WebGPU ONNX Create Session error:", er);
                    try{ //WebGL fallback
                        session = await ort.InferenceSession.create(location.origin+"/models/"+modelName, {
                            executionProviders: ['webgl'] //'wasm' 'webgl' 'webgpu'
                        });
                        console.log("Created WebGL ONNX session");
                    } catch(er) {
                        console.error("WebGL ONNX Create Session error:", er);
                        try{ //CPU fallback
                            session = await ort.InferenceSession.create(location.origin+"/models/"+modelName, {
                                executionProviders: ['wasm'] //'wasm' 'webgl' 'webgpu'
                            });
                            console.log("Created WASM ONNX session");
                        } catch(er) {console.error("WASM ONNX Create Session error:", er);}
                    }
                }


                const labelsResult = await (data.labels ? data.labels : fetch(location.origin+"/models/"+labelsName).then(r => r.text()));
                // Parse labels
                labelsList = labelsResult.split(/\n/g);
            
                return;
            }

            // return { //override
            //     name:data.name, id:data.id,
            //     width:data.width,
            //     height:data.height,
            //     cropIndex:data.cropIndex
            // };

            if(!data) return;
            //this is very slow
            let tensor
            let inp;
            
            if(data.image && data.input === 'image') {
                inp = convertRGBAToRGBPlanarNormalized(data.image, outputWidth, outputHeight);//convertRGBAtoRGBFloat32(imageData.data); 
                
                tensor = new ort.Tensor('float32', inp, [1,3,outputWidth,outputHeight]);
        
            } else if (data.image && data.input === 'imageflattened') {
                inp = convertRGBAToRGBPlanarNormalized(data.image, outputWidth, outputHeight);//convertRGBAtoRGBFloat32(imageData.data); 
                
                tensor = new ort.Tensor('float32', inp, [1,inp.length]); 
         

            } else if (data.spectral && data.input === 'spectral') {
                const is = data.spectral.intensities;
                inp = new Float32Array(is.length*4);
                let startR = is.length;
                let startG = is.length*2;
                let startB = is.length*3;
                is.forEach((intensity,i)=>{
                    inp[i] = intensity.i;
                    inp[i+startR] = intensity.r;
                    inp[i+startB] = intensity.g;
                    inp[i+startG] = intensity.b;
                });

                tensor = new ort.Tensor('float32', inp, [1,inp.length]); //1d tensor
            }
            
            // Start inference
            const input = { [inputName]:tensor };//new Input();
            //console.log(input);
            //input.insert(inputName, inp);
            const start = performance.now();
            let result;
            try {result = await session.run(input); } catch(er) { console.error(er); }
            if(!result) return {
                name:data.name, 
                id:data.id,
                width:data.width,
                height:data.height,
                cropIndex:data.cropIndex,
                input:data.input
            };
            const duration = performance.now() - start;
            inferenceCount++;
            inferenceTime += duration;
            //input.free();

            // Find the label with the highest probability
            console.log(result); 
            let key = Object.keys(result)[0];

            console.log(result);
            const probs = result[key]?.data;//result.get(outputName);
            
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
                id:data.id,
                width:data.width,
                height:data.height,
                cropIndex:data.cropIndex
            };
        }
        
        initWorker(classifyImage); //do this ASAP
        
    }
    
    initClassifier();
}

//this is a hack for importing with tinybuild
export default self as any;