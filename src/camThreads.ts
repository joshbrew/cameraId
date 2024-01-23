import threadop, { WorkerHelper, WorkerPoolHelper } from "threadop";
import { graphXIntensities, autocorrelateImageThreaded, mapBitmapXIntensities } from "./lib/imagemanip";

export type CamThreads = {
    canvasThread: WorkerHelper;
    videoDecoderThread: WorkerPoolHelper;
    poolingThread: WorkerHelper;
    classifierThread: WorkerHelper;
}

//FYI this is not prefectly organized but runs great, some things use cropIndex, some things use name, some things use id. There are various reasons for this while trying different things but it could be cleaned up.

export async function initVideoProcessingThreads(
    decoderPool = 4, 
    modelName = 'inception-mnist.onnx',
    labelsName = 'mnist-labels.txt',
    inputName = 'input',
    outputName = 'output',
    outputWidth=64, 
    outputHeight=64,
    model?:Uint8Array,
    labels?:Uint8Array
) {

    const classifierThread = await threadop('./dist/wonnx.worker.js') as WorkerHelper;

    let transfer = [] as any;
    if(model) transfer.push(model);
    if(labels) transfer.push(labels);
    classifierThread.run({
        command:'configure',
        modelName,
        labelsName,
        inputName,
        outputName,
        outputWidth,
        outputHeight,
        model,
        labels
    }, (model || labels) ? transfer : undefined);

    //this thread will handle drawing canvases and creating an image bitmap copy to send to the poolingThread
    const canvasThread = await threadop(
        function (data:{
            image:ImageBitmap, 
            spectral?:{
                intensities:{r:number,g:number,b:number,i:number}[],
                maxR:number,maxG:number,maxB:number,
                width:number,
                height:number
            }

            cropIndex:number,

            width:number,height:number, 
            
            timestamp:number,

            canvas?:OffscreenCanvas, 

            draw?:boolean, delete?:boolean, clear?:boolean
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
                    this.canvases[data.cropIndex+'s'].width = data.width;
                }
                if(data.height) {
                    this.canvases[data.cropIndex+'s'].height = data.height;
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
            } else if ('clear' in data) {
                if(this.canvases[data.cropIndex]) {
                    this.contexts[data.cropIndex].clearRect(
                        0,0,
                        this.canvases[data.cropIndex].width,
                        this.canvases[data.cropIndex].height
                    );
                }
            }
            return true;
        },
        {
            imports: {
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
                input?:string,
                cropIndex?:string,
                data?:{ //when setting
                    name:string,
                    image:Uint8ClampedArray, 
                    bmp?:ImageBitmap,
                    spectral?:{
                        intensities:{r:number,g:Number,b:Number,i:number}[],
                        maxR:number,maxG:number,maxB:number,maxI:number,
                        width:number,
                        height:number
                    }
                    autocor?:Uint8ClampedArray, 
                    autocorbmp?:ImageBitmap,
                    width:number,
                    height:number,
                    cropIndex:number,
                    timestamp:number,
                    type?:string
                }[]
            }
        ) {
            if(input.command?.includes('reset')) {
                if(!this.TempCaptures) {
                    this.reset = () => {
                        this.Baseline = undefined; //set this to normalize and subtract this data from each sample so what is reported back is adjusted 
                        this.TempCaptures = {}; 
                        this.TempACorRawData = {};
                        this.TempACorImageData = {};
                        this.TempSpectralData = {};
                        this.TempImageBMP = {};
                        this.TempImageBMPBuffer = {};
                        this.bufferOrder = [];
                        this.bufferLimit = 100; //we'll keep e.g. the last 100 results in memory per name
                        this.TempImageBufferLimit = 10; //for averaging samples
                        this.AveragingOffscreen = new OffscreenCanvas(300,300);
                        this.SubtractionOffscreen = new OffscreenCanvas(300,300);
                        this.AveragingOffscreenContext = this.AveragingOffscreen.getContext('2d',{ willReadFrequently: true });
                        this.SubtractionOffscreenContext = this.SubtractionOffscreenContext.getContext('2d',{willReadFrequently:true});
                    }
                } 
                this.reset();
                console.log('reset!')
            } else if (input.command?.includes('delete') && input.name && this.bufferOrder) {
                let foundIdx = (this.bufferOrder as string[]).findIndex((v) => {if(v === input.name) return true});
                if(foundIdx > -1) {
                    delete this.TempCaptures[input.name];
                    delete this.TempImageBMP[input.name];
                    delete this.TempACorRawData[input.name];
                    delete this.TempACorImageData[input.name];
                    delete this.TempSpectralData[input.name];
                    delete this.TempImageBMPBuffer[input.name];
                    delete this.TempImageSpectralBuffer[input.name];    
                    this.bufferOrder.splice(foundIdx);
                }

            } else if(input.command.includes('set') && input.data) {
                await Promise.all(input.data.map( async (imgData) => {
                    if(!imgData) return;
                    if(!this.TempCaptures) {
                        this.reset = () => {
                            this.Baseline = undefined; 
                            this.TempCaptures = {}; 
                            this.TempACorRawData = {};
                            this.TempACorImageData = {};
                            this.TempSpectralData = {};
                            this.bufferLimit = 100; //we'll keep e.g. the last 100 results in memory per name
                            this.bufferOrder = [];
                            this.TempImageBMP = {};
                            this.TempImgUint8Buffer = {};
                            this.TempImageBMPBuffer = {};
                            this.TempImageSpectralBuffer = {};
                            this.TempImageBufferLimit = 10; //for averaging
                            this.AveragingOffscreen = new OffscreenCanvas(300,300);
                            this.SubtractionOffscreen = new OffscreenCanvas(300,300);
                            this.AveragingOffscreenContext = this.AveragingOffscreen.getContext('2d',{ willReadFrequently: true });
                            this.SubtractionOffscreenContext = this.SubtractionOffscreen.getContext('2d',{willReadFrequently:true});
                        }
                        this.reset();
                    } 
    
                    this.bufferOrder.push(imgData.name);
                    if(this.bufferOrder.length > this.bufferLimit) {
                        delete this.TempCaptures[this.bufferOrder[0]];
                        delete this.TempImageBMP[this.bufferOrder[0]];
                        delete this.TempACorRawData[this.bufferOrder[0]];
                        delete this.TempACorImageData[this.bufferOrder[0]];
                        delete this.TempSpectralData[this.bufferOrder[0]];
                        delete this.TempImageBMPBuffer[this.bufferOrder[0]];
                        delete this.TempImageSpectralBuffer[this.bufferOrder[0]];
                        this.bufferOrder.shift();
                    }
    
                    this.TempCaptures[imgData.name] = imgData;
                    this.TempImageBMP[imgData.name] = imgData.bmp; 
                    this.TempSpectralData[imgData.name] = imgData.spectral; 
                    this.TempACorRawData[imgData.name] = imgData.autocor; 
                    this.TempACorImageData[imgData.name] = imgData.autocorbmp; 
                    
                    //todo: not that efficient but fine for one shot
                    if(imgData.image) {
                        if(!this.TempImgUint8Buffer[imgData.name]) { this.TempImgUint8Buffer[imgData.name] = []; }
                        this.TempImgUint8Buffer[imgData.name].push(imgData.image);
                        if(this.TempImgUint8Buffer[imgData.name].length > this.TempImageBufferLimit) 
                            this.TempImgUint8Buffer[imgData.name].shift();    
                    }

                    if(imgData.spectral) {
                        if(!this.TempImageSpectralBuffer[imgData.name]) { this.TempImageSpectralBuffer[imgData.name] = []; }
                        this.TempImageSpectralBuffer[imgData.name].push(imgData.spectral);
                        if(this.TempImageSpectralBuffer[imgData.name].length > this.TempImageBufferLimit) 
                            this.TempImageSpectralBuffer[imgData.name].shift();
                    }
                    
                    if(input.command.includes('averaged')) {
                        
                        if(imgData.bmp) {
                            if(!this.TempImageBMPBuffer[imgData.name]) { this.TempImageBMPBuffer[imgData.name] = []; }
                            this.TempImageBMPBuffer[imgData.name].push(imgData.bmp);
                            if(this.TempImageBMPBuffer[imgData.name].length > this.TempImageBufferLimit) 
                                this.TempImageBMPBuffer[imgData.name].shift();    
                        }

                        if(imgData.image && this.TempImgUint8Buffer[imgData.name].length > 1) {
                            let result = new Uint8ClampedArray(imgData.image);
                            let lastIdx = this.TempImgUint8Buffer[imgData.name].length - 2;
                            const l = this.TempImgUint8Buffer[imgData.name].length;
                            for(let i = 0; i < l; i++) {
                                const ll = this.TempImgUint8Buffer[imgData.name][i].length;
                                for(let j = 0; j < ll; j++) {
                                    if((j+1)%4 === 0) this.TempImgUint8Buffer[imgData.name][i][j];
                                    result[j] += this.TempImgUint8Buffer[imgData.name][i][j]; 
                                    if(i === lastIdx) result[j] /= l;
                                }
                            }
                            imgData.image = result;
                        }

                        if(imgData.bmp && this.TempImageBMPBuffer[imgData.name].length > 1) {
                            this.AveragingOffscreen.width = imgData.width;
                            this.AveragingOffscreen.height = imgData.height;
                            (this.AveragingOffscreenContext as CanvasRenderingContext2D).globalAlpha = 1/this.TempImageBMPBuffer[imgData.name].length;
                            for(const bmp of this.TempImageBMPBuffer[imgData.name]) { //assuming all the same size
                                (this.AveragingOffscreenContext as CanvasRenderingContext2D).drawImage(bmp as ImageBitmap, 0, 0);
                            }
                            // (this.AveragingOffscreenContext as CanvasRenderingContext2D).globalAlpha = 1;
                            // (this.AveragingOffscreenContext as CanvasRenderingContext2D).drawImage(this.AveragingOffscreen as ImageBitmap, 0, 0)
                            this.TempImageBMP[imgData.name] = await createImageBitmap((this.AveragingOffscreen as OffscreenCanvas)); //replace with averaged result
                        }

                        if(imgData.spectral && this.TempImageSpectralBuffer[imgData.name].length > 1) {
                            
                            let averaged:{ 
                                intensities:{r:number,g:number,b:number,i:number}[],
                                maxR:number,maxG:number,maxB:number,maxI:number,
                                width:number,
                                height:number
                            } = {
                                intensities:[],
                                maxR:0, maxG:0, maxB:0, maxI:0,
                                width:imgData.width,
                                height:imgData.height
                            };

                            let i = 0;

                            const withSpectrum = (v,j) => {
                                averaged.intensities[j].r += v.r;
                                averaged.intensities[j].g += v.g;
                                averaged.intensities[j].b += v.b;
                                averaged.intensities[j].i += v.i;
                            }

                            for(const spectrum of this.TempImageSpectralBuffer[imgData.name]) { //assuming all the same size
                                
                                if(i === 0) {
                                    spectrum.intensities.map((v)=> {
                                        averaged.intensities.push({...v});
                                    })
                                    averaged.maxR = spectrum.maxR;
                                    averaged.maxG = spectrum.maxG;
                                    averaged.maxB = spectrum.maxB;
                                } else {
                                    spectrum.intensities.forEach(withSpectrum);
                                    averaged.maxR += spectrum.maxR;
                                    averaged.maxG += spectrum.maxG;
                                    averaged.maxB += spectrum.maxB;
                                }
                                i++;
                            }
                            const l = this.TempImageSpectralBuffer[imgData.name].length;
                            averaged.maxR /= l;
                            averaged.maxG /= l;
                            averaged.maxB /= l;
                            averaged.maxI = (averaged.maxR + averaged.maxG + averaged.maxB);

                            averaged.intensities = averaged.intensities.map((v,j) => {
                                return {
                                    r:v.r/l,
                                    g:v.g/l,
                                    b:v.b/l,
                                    i:v.i/l
                                }
                            });
                            //console.log('averaged spectrum', averaged, imgData.spectral);
                            this.TempSpectralData[imgData.name] = averaged; //replace with averaged result
                        }
                    }

                    delete imgData.bmp; delete imgData.spectral; delete imgData.autocor; delete imgData.autocorbmp; //for cloning later
                }));

                return input.id;

            } else if(input.command?.includes('getbmp') && input.name) { //e.g. overrRide poolingThread that talks to canvasThread 
                const capture = this.TempCaptures[input.name];
                let imgData = this.TempImageBMP[input.name] as ImageBitmap;
                if(!imgData || !capture) return;
                
                //TODO: IMAGE SUBTRACTION ALPHA IS A LITTLE JANK
                if(this.Baseline?.bmp) {
                    this.SubtractionOffscreen.width = capture.width;
                    this.SubtractionOffscreen.height = capture.height;
                    (this.SubtractionOffscreenContext as CanvasRenderingContext2D).globalCompositeOperation = 'difference';
                    if(this.TempImageBMPBuffer[input.name]?.length > 1) (this.SubtractionOffscreenContext as CanvasRenderingContext2D).globalAlpha = 1/(this.TempImageBMPBuffer[input.name].length);
                    this.SubtractionOffscreenContext.drawImage(this.Baseline.bmp,0,0); 
                    this.SubtractionOffscreenContext.drawImage(imgData,0,0); //should subtract from the baseline (the brighter image so we shouldn't get a negative)
                    imgData = this.SubtractionOffscreen; //copy the new canvas now instead of the BMP.
                } 

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
                captureCpy.spectral = {...spectral};
                delete captureCpy.image;
                captureCpy.cropIndex = captureCpy.cropIndex;
                captureCpy.input = input.input;
                
                if(this.Baseline?.spectral) { //correct for baseline
                    const result = captureCpy.spectral.intensities.map((v,i)=> {
                        return{
                            r:this.Baseline.spectral.intensities[i].r - v.r,
                            g:this.Baseline.spectral.intensities[i].b - v.b,
                            b:this.Baseline.spectral.intensities[i].g - v.g,
                            i:this.Baseline.spectral.intensities[i].i - v.i
                        }
                    });
                    captureCpy.spectral.intensities = result;
                    captureCpy.spectral.maxR -= this.Baseline.spectral.maxR;
                    captureCpy.spectral.maxG -= this.Baseline.spectral.maxG;
                    captureCpy.spectral.maxB -= this.Baseline.spectral.maxB;
                    captureCpy.spectral.maxI -= this.Baseline.spectral.maxI;
                }
                return {
                    message:captureCpy
                };

            } else if(input.command?.includes('get') && input.name) { //e.g. overrRide poolingThread that talks to classifierThread to report data back to main thread
                const captureCpy = Object.assign({},this.TempCaptures[input.name]);
                if(!captureCpy?.image) return;

                if(this.Baseline?.image) { //should be same size
                    const result = new Uint8ClampedArray(captureCpy.image.length);

                    for (let i = 0; i < captureCpy.image.length; i++) {
                        // Skip every fourth element (alpha channel)
                        if ((i + 1) % 4 === 0) {
                            result[i] = captureCpy.image[i]; // Copy the alpha channel as-is
                            continue;
                        } else {
                            // Subtract and clamp the result between 0 and 255
                            result[i] = Math.max(0, Math.min(255, this.Baseline.image[i] - captureCpy.image[i]));
                        }
                    }
                    captureCpy.image = result;
                } else {
                    let clone = new Uint8ClampedArray((captureCpy.image as Uint8ClampedArray).length);
                    clone.set(captureCpy.image as Uint8ClampedArray);
                    captureCpy.image = clone;
                }
                captureCpy.input = input.input;

                return {
                    message:captureCpy,
                    transfer:[captureCpy.image?.buffer ? captureCpy.image.buffer : captureCpy.image]
                };
            }
            if (input.command?.includes('baseline') && input.name) {
                if(this.TempCaptures[input.name]) { 
                    this.Baseline = { //will stay referenced after rollover
                        image: this.TempCaptures[input.name],
                        bmp:this.TempImageBMP[input.name],
                        acorraw: this.TempACorRawData[input.name],
                        acorbmp: this.TempACorImageData[input.name],
                        spectral: this.TempSpectralData[input.name],
                        bmpbuffer: this.TempImageBMPBuffer[input.name],
                        spectalbuffer: this.TempImageSpectralBuffer[input.name]
                    };
                    this.TempImageBMPBuffer[input.name] = []; //reset so we don't reuse the same images
                    this.TempImageSpectralBuffer[input.name] = []; //reset so we don't reuse the same images
                }
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
                id:string,
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





