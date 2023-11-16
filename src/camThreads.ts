import threadop, { WorkerHelper, WorkerPoolHelper } from "threadop";
import { graphXIntensities, autocorrelateImageThreaded, mapBitmapXIntensities } from "./lib/imagemanip";

export type CamThreads = {
    canvasThread: WorkerHelper;
    videoDecoderThread: WorkerPoolHelper;
    poolingThread: WorkerHelper;
    classifierThread: WorkerHelper;
}

export async function initVideoProcessingThreads(
    decoderPool = 4, 
    modelName = 'inception-mnist.onnx',
    labelsName = 'mnist-labels.txt',
    inputName = 'input',
    outputName = 'output',
    outputWidth=64, 
    outputHeight=64
) {

    const classifierThread = await threadop('./dist/wonnx.worker.js') as WorkerHelper;

    classifierThread.run({
        command:'configure',
        modelName,
        labelsName,
        inputName,
        outputName,
        outputWidth,
        outputHeight
    });

    //this thread will handle drawing canvases and creating an image bitmap copy to send to the poolingThread
    const canvasThread = await threadop(
        function (data:{
            image:ImageBitmap, 
            spectral?:{
                intensities:{r:number,g:number,b:number,i:number},
                maxR:number,maxG:number,maxB:number,
                width:number,
                height:number
            }

            cropIndex:number,

            width:number,height:number, 
            
            timestamp:number,

            canvas?:OffscreenCanvas, 

            draw?:boolean, delete?:boolean
        }) {    
            if(!data) return;
            //handle offscreencanvas draws on this thread because why not
            if(data.canvas) {
                if(!this.canvases) {this.canvases = {}; this.contexts = {};}
                this.canvases[data.cropIndex] = data.canvas;
                let ctx = data.canvas.getContext('2d');
                this.contexts[data.cropIndex] = ctx;
            }

            if('draw' in data && this.canvases?.[data.cropIndex]) {
                if(data.width) {
                    this.canvases[data.cropIndex].width = data.width;
                }
                if(data.height) {
                    this.canvases[data.cropIndex].height = data.height;
                }
                (this.contexts[data.cropIndex] as CanvasRenderingContext2D)?.drawImage(
                    data.image,
                    0,
                    0,
                    this.canvases[data.cropIndex].width,
                    this.canvases[data.cropIndex].height
                ); //ImageBitmap

                // (this.contexts[data.name] as CanvasRenderingContext2D).fillStyle = 'orange';
                // (this.contexts[data.name] as CanvasRenderingContext2D).fillRect(
                //   this.canvases[data.name].width*.3,
                //   this.canvases[data.name].height*.3,
                //   this.canvases[data.name].width*.4,
                //   this.canvases[data.name].height*.4
                // );
            } else if('drawSpectral' in data && this.canvases?.[data.cropIndex] && data.spectral) {
                if(data.width) {
                    this.canvases[data.cropIndex].width = data.width;
                }
                if(data.height) {
                    this.canvases[data.cropIndex].height = data.height;
                }
                
                graphXIntensities(
                    this.contexts[data.cropIndex],
                    data.spectral?.intensities,
                    data.width,
                    data.height
                );

            } else if ('delete' in data && this.canvases[data.cropIndex]) {
                this.contexts[data.cropIndex].clearRect(
                    0,0,
                    this.canvases[data.cropIndex].width,
                    this.canvases[data.cropIndex].height
                );
                delete this.canvases[data.cropIndex];
                delete this.contexts[data.cropIndex];
            }
            return true;
        },
        {
            imports:{
                ['./src/lib/imagemanip.js']:{
                    'graphXIntensities':true
                }
            }
        }
    ) as WorkerHelper;


    //this thread stores image data and returns copies. Uses transfers for speeeed
    const poolingThread = await threadop( //overridePort to get main thread data back, else get will pass to classifierThread
        async function(
            input:{
                command:string,
                name?:string,
                id?:string,
                cropIndex?:string,
                data?:{ //when setting
                    name:string,
                    image:Uint8ClampedArray, 
                    bmp?:ImageBitmap,
                    spectral?:{
                        intensities:{r:number,g:number,b:number,i:number},
                        maxR:number,maxG:number,maxB:number,
                        width:number,
                        height:number
                    }
                    autocor?:Uint8ClampedArray, 
                    autocorbmp?:ImageBitmap,
                    width?:number,
                    height?:number,
                    cropIndex:number,
                    timestamp:number,
                    type?:string
                }[]
            }
        ) {
            if(input.command?.includes('set') && input.data) {
                input.data.forEach((imgData) => {
                    if(!imgData) return;
                    if(!this.TempCaptures) {
                        this.TempCaptures = {}; 
                        this.TempImageData = {};
                        this.TempACorRawData = {};
                        this.TempACorImageData = {};
                        this.TempSpectralData = {};
                        this.bufferLimit = 100; //we'll keep e.g. the last 100 results in memory
                        this.bufferOrder = [];
                    } 
    
                    this.bufferOrder.push(imgData.name);
                    if(this.bufferOrder.length > this.bufferLimit) {
                        delete this.TempCaptures[this.bufferOrder[0]];
                        delete this.TempImageData[this.bufferOrder[0]];
                        delete this.TempACorRawData[this.bufferOrder[0]];
                        delete this.TempACorImageData[this.bufferOrder[0]];
                        delete this.TempSpectralData[this.bufferOrder[0]];
                        this.bufferOrder.shift();
                    }
    
                    this.TempImageData[imgData.name] = imgData.bmp; 
                    this.TempSpectralData[imgData.name] = imgData.spectral; 
                    this.TempACorRawData[imgData.name] = imgData.autocor; 
                    this.TempACorImageData[imgData.name] = imgData.autocorbmp; 
                    delete imgData.bmp; delete imgData.spectral; delete imgData.autocor; delete imgData.autocorbmp;
                    this.TempCaptures[imgData.name] = imgData;
                });
                return input.id;
            } else if(input.command?.includes('getbmp') && input.name) { //e.g. overrRide poolingThread that talks to canvasThread 
                const capture = this.TempCaptures[input.name];
                const imgData = this.TempImageData[input.name] as ImageBitmap;
                if(!imgData || !capture) return;
                return await new Promise((res,rej) => {
                    createImageBitmap(imgData,0,0,capture.width,capture.height).then((bmp) => {
                        let captureCpy = Object.assign({
                            draw:true
                        },capture,{
                            image:bmp
                        });
                        res({
                            message:captureCpy,
                            transfer:[bmp]
                        }); 
                    }).catch(rej);
                });
            } else if(input.command?.includes('getautocorbmp') && input.name) { //e.g. overrRide poolingThread that talks to canvasThread 
                const capture = this.TempCaptures[input.name];
                const imgData = this.TempACorImageData[input.name] as ImageBitmap;
                if(!imgData || !capture) return;
                return await new Promise((res,rej) => {
                    createImageBitmap(imgData,0,0,capture.width,capture.height).then((bmp) => {
                        let captureCpy = Object.assign({
                            draw:true
                        },capture,{
                            image:bmp
                        });
                        res({
                            message:captureCpy,
                            transfer:[bmp]
                        }); 
                    }).catch(rej);
                });
            } else if(input.command?.includes('getautocor') && input.name) { //e.g. overrRide poolingThread that talks to classifierThread to report data back to main thread
                const captureCpy = Object.assign({},this.TempCaptures[input.name]);
                if(!captureCpy || !this.TempACorRawData[input.name]) return;
                let clone = new Uint8ClampedArray((this.TempACorRawData[input.name] as Uint8ClampedArray).length);
                clone.set(this.TempACorRawData[input.name] as Uint8ClampedArray);
                captureCpy.image = clone;
                return {
                    message:captureCpy,
                    transfer:[captureCpy.image?.buffer ? captureCpy.image.buffer : captureCpy.image]
                };
            } else if(input.command?.includes('getspectral') && input.name) { //e.g. overrRide poolingThread that talks to classifierThread to report data back to main thread
                const captureCpy = Object.assign({drawSpectral:true},this.TempCaptures[input.name]);
                const spectral = this.TempSpectralData[input.name];
                if(!captureCpy || !spectral) return;
                captureCpy.spectral = spectral;
                delete captureCpy.image;
                captureCpy.cropIndex = captureCpy.cropIndex + 's';
                return {
                    message:captureCpy
                };
            } else if(input.command?.includes('get') && input.name) { //e.g. overrRide poolingThread that talks to classifierThread to report data back to main thread
                const captureCpy = Object.assign({},this.TempCaptures[input.name]);
                if(!captureCpy?.image) return;
                let clone = new Uint8ClampedArray((captureCpy.image as Uint8ClampedArray).length);
                clone.set(captureCpy.image as Uint8ClampedArray);
                captureCpy.image = clone;
                return {
                    message:captureCpy,
                    transfer:[captureCpy.image?.buffer ? captureCpy.image.buffer : captureCpy.image]
                };
            }
        },
        {
            port:[classifierThread.worker,canvasThread.worker] //be sure to use overridePort to specify main thread or classifierThread or canvasThread as transfers only work once
        }
    ) as WorkerHelper;



    //turn VideoFrames into raw image data
    const videoDecoderThread = await threadop(
        async function(input:{
            image:VideoFrame|Uint8ClampedArray, //source image
            //source image dims
            width:number,
            height:number,
            command?:string, 
            id:string,
            spectral?:boolean, //map x intensity spectrum (digital spectrogram)
            autocor?:boolean, //image autocorrelation
            data:{ //and these are all the resulting outputs we want
                name:string,
                timestamp:number,
                //output image dims allows image rescaling with offscreen canvases
                cropX?:number, //crop rect x0,y0,width,height
                cropY?:number, 
                cropW?:number,
                cropH?:number, 
                cropIndex?:number,
                outputWidth?:number, //resize output? defaults to crop or main width/height dims
                outputHeight?:number,
                //for next thread
                type:string
            }[],
            overridePort?:string;
        }) {
            let image:ImageData|VideoFrame;
            if((input.image as Uint8ClampedArray)?.buffer) {
                image = new ImageData(input.image as Uint8ClampedArray, input.width, input.height);
            } else image = input.image as VideoFrame;
 
            //process multiple image bounding boxes
            let result = [] as any; 
            for(let i = 0; i < input.data.length; i++) {
                const data = input.data[i];
                if(!data) return;
                if(!this.offscreen) {
                    this.offscreen = new OffscreenCanvas(
                        data.outputWidth || data.cropW || input.width,
                        data.outputHeight || data.cropH || input.height
                    );
                    this.backupOffscreen = new OffscreenCanvas(
                        input.width,
                        input.height
                    )
                    this.ctx = this.offscreen.getContext('2d',{ willReadFrequently: true });
                    this.bctx = this.backupOffscreen.getContext('2d',{ willReadFrequently: true });
                } else {
                    this.offscreen.width = data.outputWidth || data.cropW || input.width; 
                    this.offscreen.height = data.outputHeight || data.cropH || input.height;
                }
                    
                let bmp:ImageBitmap|undefined;
                        
                if(image instanceof VideoFrame) {       
                    // console.log(
                    //     'x',(data.cropX || 0),
                    //     'y',(data.cropY || 0),
                    //     'w',data.cropW || input.width,
                    //     'h',data.cropH || input.height,
                    //     0,
                    //     0,
                    //     this.offscreen.width,
                    //     this.offscreen.height
                    // );
                    //crop the image
                    (this.ctx as CanvasRenderingContext2D).drawImage(
                        image as VideoFrame,
                        data.cropX || 0,
                        data.cropY || 0,
                        data.cropW || input.width,
                        data.cropH || input.height,
                        0,
                        0,
                        this.offscreen.width,
                        this.offscreen.height
                    ); //rescales

                    if(i === input.data.length-1) (image as VideoFrame).close();
                } else {
                    this.backupOffscreen.width = input.width;
                    this.backupOffscreen.height = input.height;

                    (this.bctx as CanvasRenderingContext2D).putImageData(image,0,0); 
                    (this.ctx as CanvasRenderingContext2D).drawImage(
                        this.backupOffscreen as OffscreenCanvas,
                        data.cropX || 0,
                        data.cropY || 0,
                        data.cropW || input.width,
                        data.cropH || input.height,
                        0,
                        0,
                        this.offscreen.width,
                        this.offscreen.height
                    ); //rescales   
                }

               
                //create a bmp for future rendering purposes
                let prom = createImageBitmap(this.offscreen as OffscreenCanvas);

                let scaledData = (this.ctx as CanvasRenderingContext2D).getImageData(
                    0, 0,
                    this.offscreen.width,
                    this.offscreen.height
                ).data

                //autocorrelation
                let acor;
                if(input.autocor) { //this is VERY slow
                    acor = autocorrelateImageThreaded(
                        scaledData, 
                        this.offscreen.width, 
                        this.offscreen.height
                    );
                }

                bmp = await prom; //this is the only way to convert the video YUV planes to RGB data officially   
                //if we've made all the crops we want, close the source frame
         
                let crop = {
                    ...data,
                    bmp,
                    image:scaledData,
                    width: this.offscreen.width,
                    height: this.offscreen.height
                } as any;

                let transfer = [crop.image.buffer, bmp];
                
                if(input.autocor) {
                    crop.autocor = await acor;
                    crop.autocorbmp = await createImageBitmap(
                        new ImageData(
                            crop.autocor,
                            this.offscreen.width,
                            this.offscreen.height
                        )
                    )
                    transfer.push(crop.autocor.buffer, crop.autocorbmp);
                }

                if(input.spectral) {
                    crop.spectral = mapBitmapXIntensities(
                        scaledData,
                        this.offscreen.width,
                        this.offscreen.height
                    );
                }

                result.push({message:crop, transfer});

            }

            let output = {
                message:{data:[] as any[], 
                command:input.command,
                id:input.id
            }, transfer:[] as any[], overridePort:input.overridePort};

            result.forEach((value) => {
                if(!value) return;
                output.message.data.push(value.message);
                output.transfer.push(...value.transfer);
            })

            return output;
        },
        {
            imports:{ //this can be tricky, but the main thing is you need distributable js files, no node imports
                ['./src/lib/imagemanip.js']:{
                    'autocorrelateImageThreaded':true,
                    'autocorrelateImage':true,
                    'mapBitmapXIntensities':true
                }
            },
            port:[poolingThread.worker],//,
            pool:decoderPool //the imagebitmaps are slow so this keeps the thread from backing up
        }
    ) as WorkerPoolHelper;

    return {
        canvasThread, 
        videoDecoderThread, 
        poolingThread, 
        classifierThread
    };

}





