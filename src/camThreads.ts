import threadop, { WorkerHelper, WorkerPoolHelper } from "threadop";


export async function initVideoProcessingThreads(
    decoderPool = 4, 
    modelName = 'inception-mnist.onnx',
    labelsName = 'mnist-labels.txt',
    inputName = 'input',
    outputName = 'output',
    outputWidth=64, 
    outputHeight=64
) {

    const classifierThread = await threadop('./dist/esm/src/wonnx.thread.js') as WorkerHelper;

    classifierThread.run({
        command:'configure',
        modelName,
        labelsName,
        inputName,
        outputName,
        outputWidth,
        outputHeight
    })


    //this thread will handle drawing canvases and creating an image bitmap copy to send to the poolingThread
    const canvasThread = await threadop(
        function (data:{
            image:ImageBitmap,name:string,width:number,height:number,type:string, timestamp:number,
            canvas?:OffscreenCanvas, draw?:boolean, delete?:boolean
        }) {    
            if(!data) return;
            //handle offscreencanvas draws on this thread because why not
            if(data.canvas) {
                if(!this.canvases) {this.canvases = {}; this.contexts = {};}
                this.canvases[data.name] = data.canvas;
                let ctx = data.canvas.getContext('2d');
                this.contexts[data.name] = ctx;
            }

            if(data.draw && this.canvases?.[data.name]) {
                (this.contexts[data.name] as CanvasRenderingContext2D)?.drawImage(
                    data.image,
                    0,
                    0,
                    this.canvases[data.name].width,
                    this.canvases[data.name].height
                ); //ImageBitmap

                // (this.contexts[data.name] as CanvasRenderingContext2D).fillStyle = 'orange';
                // (this.contexts[data.name] as CanvasRenderingContext2D).fillRect(
                //   this.canvases[data.name].width*.3,
                //   this.canvases[data.name].height*.3,
                //   this.canvases[data.name].width*.4,
                //   this.canvases[data.name].height*.4
                // );
            } else if (data.delete && this.canvases[data.name]) {
                this.contexts[data.name].clearRect(
                    0,0,
                    this.canvases[data.name].width,
                    this.canvases[data.name].height
                );
                delete this.canvases[data.name];
                delete this.contexts[data.name];
            }

            return true;
        }
    ) as WorkerHelper;





    //this thread stores image data and returns copies. Uses transfers for speeeed
    const poolingThread = await threadop( //overridePort to get main thread data back, else get will pass to classifierThread
        async function(data:{
            command:string,
            name:string,
            image:Uint8ClampedArray, 
            bmp?:ImageBitmap,
            width?:number,
            height?:number,
            timestamp:number,
            type?:string
        }) {
            if(!data) return;
            if(data.command?.includes('set')) {
                if(!this.TempCaptures) {
                    this.TempCaptures = {}; 
                    this.TempImageData = {};
                    this.bufferLimit = 25; //we'll keep e.g. the last 100 results in memory
                    this.bufferOrder = [];
                } 

                this.bufferOrder.push(data.name);
                if(this.bufferOrder.length > this.bufferLimit) {
                    delete this.TempCaptures[this.bufferOrder[0]];
                    delete this.TempImageData[this.bufferOrder[0]];
                    this.bufferOrder.shift();
                }

                this.TempImageData[data.name] = data.bmp; delete data.bmp;
                this.TempCaptures[data.name] = data;

            }


            if(data.command?.includes('getbmp')) { //e.g. overrRide poolingThread that talks to canvasThread 
                const capture = this.TempCaptures[data.name];
                const imgData = this.TempImageData[data.name] as ImageBitmap;
                if(!capture?.image) return;
                return new Promise((res,rej) => {
                    createImageBitmap(imgData,0,0,capture.width,capture.height).then((bmp) => {
                        let captureCpy = Object.assign({draw:true},capture,{image:bmp});
                        res({message:captureCpy,transfer:[bmp]}); 
                    }).catch(rej);
                });
            } 

            else if(data.command?.includes('get')) { //e.g. overrRide poolingThread that talks to classifierThread to report data back to main thread
                const capture = Object.assign({},this.TempCaptures[data.name]);
                if(!capture?.image) return;
                let clone = new Uint8ClampedArray((capture.image as Uint8ClampedArray).length);
                clone.set(capture.image as Uint8ClampedArray);
                capture.image = clone;

                return {
                    message:capture,
                    transfer:[capture.image?.buffer ? capture.image.buffer : capture.image]
                };
            }

            return data.name;
        },
        {
            port:[classifierThread.worker,canvasThread.worker] //be sure to use overridePort to specify main thread or classifierThread or canvasThread as transfers only work once
        }
    ) as WorkerHelper;



    //turn VideoFrames into raw image data
    const videoDecoderThread = await threadop(
        async function(data:{
            image:VideoFrame|Uint8ClampedArray,
            name:string,
            timestamp:number,
            //source image dims
            width:number,
            height:number,
            //output image dims allows image rescaling with offscreen canvases
            outputWidth?:number,
            outputHeight?:number,

            //for next thread
            type:string,
            command?:string, 
            bmp?:ImageBitmap, 
            overridePort?:any
        }) {
 

            if(!data) return;
            if(!this.offscreen) {
                this.offscreen = new OffscreenCanvas(
                    data.outputWidth ? data.outputWidth : data.width,
                    data.outputHeight ? data.outputHeight : data.height
                );
                this.ctx = this.offscreen.getContext('2d',{ willReadFrequently: true });
                (this.ctx as CanvasRenderingContext2D)
            }
                
            let image:any = data.image;
            let bmp:ImageBitmap|undefined;

            let options = {} as ImageBitmapOptions; 
            if (data.outputWidth) options.resizeWidth = data.outputWidth; 
            if(data.outputHeight) options.resizeHeight = data.outputHeight;
            if((image as Uint8ClampedArray)?.buffer) {
                image = new ImageData(data.image as Uint8ClampedArray, data.width, data.height);
                bmp = await createImageBitmap(image as ImageData, options); //this is the only way to convert the video YUV planes to RGB data officially
                    
            } else {
                bmp = await createImageBitmap(image as VideoFrame, options); //this is the only way to convert the video YUV planes to RGB data officially   
                (image as VideoFrame).close();
            }

            this.offscreen.width = data.outputWidth ? data.outputWidth : data.width; 
            this.offscreen.height = data.outputHeight ? data.outputHeight : data.height;
            
            (this.ctx as CanvasRenderingContext2D).drawImage(
                bmp,
                0,0,
                this.offscreen.width,
                this.offscreen.height
            ); //rescales

            data.bmp = bmp;
            data.image = (this.ctx as CanvasRenderingContext2D).getImageData(
                0,0,
                this.offscreen.width,
                this.offscreen.height
            ).data;
                        
            //allow image rescaling
            if(data.outputWidth) {
                data.width = data.outputWidth;
                delete data.outputWidth;
            }
            if(data.outputHeight) {
                data.height = data.outputHeight;
                delete data.outputHeight;
            }

            return {message:data, transfer:[data.image.buffer, bmp], overridePort:data.overridePort};
       
        },
        {
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