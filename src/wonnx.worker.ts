import init, { main, Session, Input } from "@webonnx/wonnx-wasm";
import { convertRGBAToRGBPlanar, convertRGBAtoRGBFloat32 } from "./lib/imagemanip"
import {initWorker} from 'threadop'

//@ts-ignore
if(globalThis instanceof WorkerGlobalScope) {


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


        let session:Session, labelsList:string[];

        async function classifyImage(data:{
            image:Uint8ClampedArray,
            name:any,
            type:any,
            width:number,
            height:number,
            timestamp:number,
            cropIndex:number,

            command?:'configure',
            modelName?:string, //in models/
            labelsName?:string, //in models/
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
            
                return;
            }

            if(!data) return;
            //this is very slow
            const imageTransformed = convertRGBAToRGBPlanar(data.image, outputWidth, outputHeight);//convertRGBAtoRGBFloat32(imageData.data); 
   
            // Start inference
            const input = new Input();
            input.insert(inputName, imageTransformed);
            const start = performance.now();
            let result;
            try {result = await session.run(input); } catch(er) { console.error(er); }
            if(!result) return {
                name:data.name,
                width:data.width,
                height:data.height,
                cropIndex:data.cropIndex
            };
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