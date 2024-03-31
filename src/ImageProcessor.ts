// ImageProcessor.ts
import { BoundingBoxTool } from "./image_utils/boundingBoxTool";
import { MediaElementCreator } from "./image_utils/MediaElementCreator";
import { CamThreads, initVideoProcessingThreads } from "./camThreads";
import { CSV } from './data_util/csv'

import './lib/modalbutton' //<modal-button></modal-button>

import './imageprocessor_component'
import {ImageProcessorComponent} from  './imageprocessor_component'

//@ts-ignore
import resulthtml from './imageprocessorresult.html'


        
import { GDrive } from './data_util/BFS_GDrive';

//todo: put somewhere secure
const apiKey = "AIzaSyCqeebtrrt1VZh6oqqEFPCglTk6HkRlnrw";
const clientId = "454181160578-ngnp0n8bconuso73ta12ogn72189a10b.apps.googleusercontent.com";
const gdrive = new GDrive(apiKey, clientId, "Fishazam"); 

export const classifierSettings = {
    defaultclassifier:{
        modelInpWidth:224, 
        modelInpHeight:224,
        threadSettings:{
            decoderPool:4,
            modelName:'opt-squeeze.onnx',
            labelsName:'squeeze-labels.txt',
            //just single i/o for now
            inputName:'data',
            outputName:'squeezenet0_flatten0_reshape0',
            input:'image'
        }
    },
    spectralclassifier:{
        modelInpWidth:800, 
        modelInpHeight:600,
        threadSettings:{
            decoderPool:4,
            modelName:'arducam1_binary_fishazam-xgboost-classifier-spectrum.onnx',
            labelsName:'fish-binary-labels.txt', //fish-binary-labels
            inputName:'input',
            outputName:'probabilities',
            input:'spectral'
        }
    },
    imageclassifier:{
        modelInpWidth:512, 
        modelInpHeight:512,
        threadSettings:{
            decoderPool:4,
            modelName:'pipeline_xgboost_image_fillet_512.onnx',
            labelsName:'fish-labels.txt',
            //just single i/o for now
            inputName:'input',
            outputName:'probabilities',
            input:'imageflattened'
        }
    }
} as {
    [key:string]:{
        modelInpWidth:number; 
        modelInpHeight:number;
        threadSettings:{
            decoderPool?: number;
            modelName?: string;
            labelsName?: string;
            inputName?: string;
            outputName?: string;
            input?:'image'|'spectral'|'imageflattened'; //input image or spectrum CSV
        }
    }
};


export class ImageProcessor {

    id;
    ui:ImageProcessorComponent;
    root:ShadowRoot;
    Media:MediaElementCreator;
    BBTool:BoundingBoxTool;
    threads:CamThreads;
    parentElement:HTMLElement;
    container:HTMLElement;
    streamVideo:HTMLInputElement;
    useSpectralAnalysis:HTMLInputElement;
    useAutocor:HTMLInputElement;
    usePano:HTMLInputElement;
    useAveraging:HTMLInputElement;
    modelForm:HTMLFormElement;

    outputWidth:number;
    outputHeight:number;

    poolCt=0;
    poolCtMaxIdx = 3;
    threadRunning = false;

    classifierWait;
    classifierResults;
    canvasPool = [] as any[]; // Array to store available canvases

    animation;

    selectedClassifier = 'spectralclassifier';
    selectedInput:'spectral'|'imageflattened'|'image' = 'spectral';
    baselineSet = false;

    gdrive:GDrive;

    newFrame; //new frame promise

    constructor(
        parentElement=document.body,
        modelInpWidth:number=classifierSettings['spectralclassifier'].modelInpWidth, 
        modelInpHeight:number=classifierSettings['spectralclassifier'].modelInpHeight, 
        threadSettings:{
            decoderPool?: number;
            modelName?: string;
            labelsName?: string;
            inputName?: string;
            outputName?: string;
            input?:'image'|'spectral'|'imageflattened'; //input image or spectrum CSV
        }=classifierSettings['spectralclassifier'].threadSettings
    ) {
        this.init(
            parentElement,
            modelInpWidth,
            modelInpHeight,
            threadSettings
        );    
    }   

    init(
        parentElement=document.body,
        modelInpWidth:number=classifierSettings['spectralclassifier'].modelInpWidth, 
        modelInpHeight:number=classifierSettings['spectralclassifier'].modelInpHeight, 
        threadSettings:{
            decoderPool?: number;
            modelName?: string;
            labelsName?: string;
            inputName?: string;
            outputName?: string;
            input?:'image'|'spectral'|'imageflattened'; //input image or spectrum CSV
        }=classifierSettings['spectralclassifier'].threadSettings
    ) {

        if(parentElement) this.parentElement = parentElement;

        const ui = document.createElement('image-processor') as ImageProcessorComponent;

        if(modelInpWidth) ui.modelInpWidth = modelInpWidth;
        if(modelInpHeight) ui.modelInpHeight = modelInpHeight;
        if(threadSettings) {
            ui.threadSettings = threadSettings;
            if(threadSettings.input) this.selectedInput = threadSettings.input;
        }

        ui.updateTemplate();

        this.parentElement.appendChild(ui);
        // Initialize the processor with the provided settings

        this.ui = ui;
        this.root = this.ui.shadowRoot as ShadowRoot; //this actually contains the html

        // Callback functions
        const oncreate = (id, element) => {
            console.log('Image, stream or video created with ID or URL:', id);
        };

        const onstarted = (id, element) => {
            console.log('Stream or video started with ID or URL:', id);

            const onframe = (now, metadata) => {
                if(this.onframe) this.onframe(now,metadata);
                (element as HTMLVideoElement).requestVideoFrameCallback(onframe);
            }

            (element as HTMLVideoElement).requestVideoFrameCallback(onframe);
        };

        const ondelete = (id, element) => {
            console.log('Media element removed with ID or URL:', id);
            // Perform additional cleanup if necessary
        };

        const ontargetchanged = (id, element) => {
            this.BBTool?.clearBoundingBoxes(true);
            this.BBTool = new BoundingBoxTool(element, { 
                color: 'orange',
                labelColor: 'orange',
                oncreate: (box, boxes) => { 
                    console.log("Created", box, boxes); 
                    if(boxes.length === 1) 
                        this.threads.poolingThread.run({command:'delete', name:`0`},undefined,true);
                },
                // onedited: (box, boxes, boxIndex) => { 
                //     //console.log("Edited", box, boxes); 
                // },
                ondelete: (box, boxes, boxIndex) => { 
                    console.log("Deleted", box, boxes);  
                    this.threads.poolingThread.run({command:'delete', name:boxIndex},undefined,true);
                }
            });
            this.clearCanvases();

            setTimeout(()=>{
                const textElm = (this.root.querySelector('#mediaDims') as HTMLElement);
                if(textElm) textElm.innerText = `${element.videoWidth || element.naturalWidth || element.width}x${element.videoHeight || element.naturalHeight || element.height}`;
            },300);
            console.log('Stream target changed with ID or URL:', id);
        };

        
        this.container = this.root.querySelector(`#container`) as HTMLElement;
        this.streamVideo = this.root.querySelector(`#streamvideo`) as HTMLInputElement;

        this.useSpectralAnalysis = this.root.querySelector(`#spectral`) as HTMLInputElement;
        this.useSpectralAnalysis.checked = threadSettings.input === 'spectral'; //defaults
        //this.useAutocor = this.parentElement.querySelector(`#autocorrelate${this.id}`) as HTMLInputElement;
        //this.usePano = this.parentElement.querySelector(`#pano${this.id}`) as HTMLInputElement;
        this.useAveraging = this.root.querySelector(`#average`) as HTMLInputElement;
        this.useAveraging.checked = threadSettings.input === 'spectral'; //defaults
        let animating = false;

        // this.usePano.onchange = () => {
        //     if(this.useAveraging.checked) this.useAveraging.click();
        //     if(this.useAutocor.checked) this.useAutocor.click();
        // }
        const settingsModal = this.root.querySelector(`#settingsModal1`) as HTMLElement;
        this.modelForm = settingsModal.querySelector(`#classifier-form`) as HTMLFormElement;

        (settingsModal.querySelector(`#load`) as HTMLButtonElement).onclick = async () => {
            if(!this.modelForm.checkValidity()) {
                (settingsModal.querySelector(`#custommsg`) as HTMLElement).innerText = "Please fill out all fields";
            } else {

                function readFileAsUint8Array(file) {
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => {
                            const arrayBuffer = reader.result;
                            const uint8Array = new Uint8Array(arrayBuffer as ArrayBuffer);
                            resolve(uint8Array);
                        };
                        reader.onerror = () => reject(reader.error);
                        reader.readAsArrayBuffer(file);
                    });
                }

                (settingsModal.querySelector(`#custommsg`) as HTMLElement).innerText = "";
                const formData = new FormData(this.modelForm);
        
                // Process file inputs for 'model' and 'labels'
                const modelFile = formData.get('model'); //file url with access permission granted via user input
                const labelsFile = formData.get('labels');
        
                let fileResults = await Promise.all([readFileAsUint8Array(modelFile), readFileAsUint8Array(labelsFile)]).catch(error => {
                    console.error("Error reading files:", error);
                    (settingsModal.querySelector(`#custommsg`) as HTMLElement).innerText = "Error loading files";
                }) as Uint8Array[];

                let settings = {
                    modelInpWidth: Number(formData.get('width')),
                    modelInpHeight: Number(formData.get('height')),
                    threadSettings: {
                        decoderPool: 4,
                        model: fileResults[0],
                        labels: fileResults[1],
                        inputName: String(formData.get('input')),
                        outputName: String(formData.get('output'))
                    }
                };

                this.deinit();
                this.init(
                    this.parentElement,
                    settings.modelInpWidth,
                    settings.modelInpHeight,
                    settings.threadSettings
                )
            }
        }

        const handleClassifierChange = (event) => {

            const selectedValue = event.target.id;

            if(event.target.checked && selectedValue === 'customclassifier') {
                (settingsModal.querySelector('#customtable') as HTMLElement).style.display = '';
            } else (settingsModal.querySelector('#customtable') as HTMLElement).style.display = 'none';

            this.selectedClassifier = selectedValue;
            console.log(`Selected classifier: ${selectedValue}`);

            if(selectedValue !== 'customclassifier') {
                this.deinit();
                let settings = classifierSettings[selectedValue];
                this.init(parentElement, settings.modelInpWidth, settings.modelInpHeight, settings.threadSettings);
            }

        }

        // Add event listeners
        settingsModal.querySelectorAll('input[type="radio"][name="classifier"]').forEach((radio:Element) => {
            if(radio.id === this.selectedClassifier) (radio as HTMLInputElement).checked = true; else (radio as HTMLInputElement).checked = false;
            radio.addEventListener('change', handleClassifierChange.bind(this));
        });
        

        this.streamVideo.onchange = () => {
            if(this.streamVideo.checked) {
                animating = true;
                const anim = async () => {
                    if(!animating) return;
                    await this.processBoundingBoxes(); //will prevent thread backup
                    this.animation = requestAnimationFrame(anim);
                }
                this.animation = requestAnimationFrame(anim);
            } else if(this.animation) {
                animating = false;
                cancelAnimationFrame(this.animation);
            }
        }

        this.useSpectralAnalysis.onchange = () => {
            if(!(this.root.querySelector('#savespectrum'+0) as HTMLElement)) return;
            if(this.useSpectralAnalysis.checked) {
                (this.root.querySelector('#savespectrum'+0) as HTMLElement).style.display = '';
                (this.root.querySelector('#savespectrumcsv'+0) as HTMLElement).style.display = '';
                (this.root.querySelector('#canvas2'+0) as HTMLElement).style.display = '';
                this.BBTool.boxes.forEach((b,i) => {
                    if(i===0) return;
                    (this.root.querySelector('#savespectrum'+i) as HTMLElement).style.display = '';
                    (this.root.querySelector('#savespectrumcsv'+i) as HTMLElement).style.display = '';
                    (this.root.querySelector('#canvas2'+i) as HTMLElement).style.display = '';
                })
            } else {
                (this.root.querySelector('#savespectrum'+0) as HTMLElement).style.display = 'none';
                (this.root.querySelector('#savespectrumcsv'+0) as HTMLElement).style.display = 'none';
                (this.root.querySelector('#canvas2'+0) as HTMLElement).style.display = 'none';
                this.BBTool.boxes.forEach((b,i) => {
                    (this.root.querySelector('#savespectrum'+i) as HTMLElement).style.display = 'none';
                    (this.root.querySelector('#savespectrumcsv'+i) as HTMLElement).style.display = 'none';
                    (this.root.querySelector('#canvas2'+i) as HTMLElement).style.display = 'none';
                })
            }
        };

        // Initialize MediaElementCreator
        this.Media = new MediaElementCreator(
            this.root.querySelector('#mediaElm') as HTMLElement,
            {
                oncreate: oncreate,
                onstarted: onstarted,
                ondelete: ondelete,
                ontargetchanged: ontargetchanged
            }
        );

        this.outputWidth = modelInpWidth;
        this.outputHeight = modelInpHeight;

        this.initThreads(modelInpWidth, modelInpHeight, threadSettings); 
               
        const captureButton = (this.root.querySelector('#capture') as HTMLElement);
        captureButton.title = "Take Snapshot";

        //event listener for capture button processes sequences
        const captureClick = async () => {

            captureButton.onclick = () => {};

            // Add the active class to trigger the animation
            captureButton.classList.add('capture-btn-active');

            // Reattach the click event listener after the animation ends
            captureButton.addEventListener('animationend', () => {
                // Remove the active class after the animation
                captureButton.classList.remove('capture-btn-active');
            });
            
            const dummy = () => {} //reset
            if(this.useAveraging) {
                for(let i = 0; i < 9; i++) {
                    //console.log('awaiting');
                    await this.processBoundingBoxes(false, false);   
                    
                    if((this.Media.currentMediaElement as HTMLVideoElement).videoWidth) await new Promise((res,rej)=>{
                        this.onframe = (now) => {
                            this.onframe = dummy; //reset
                            //console.log("frame",now);
                            res(true);
                        }
                    }); //await next frame
                }
                await this.processBoundingBoxes(true, true);   
            } else {
                await this.processBoundingBoxes();
            }

            captureButton.onclick = captureClick; //re-enstate the event listener
        };

        captureButton.onclick = captureClick;



        ///initializing the google drive stuff

        this.gdrive = gdrive;
        const form = this.root.querySelector('#apiForm') as HTMLFormElement;
        const authButton = this.root.querySelector('#auth-button') as HTMLButtonElement;

        form.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent the form from submitting normally
            
            // Check if the form is valid
            if (form.checkValidity()) {
                const apiKey = (this.root.querySelector('#apikey') as HTMLInputElement).value.trim();
                const clientId = (this.root.querySelector('#clientid') as HTMLInputElement).value.trim();
                const directory = (this.root.querySelector('#directory') as HTMLInputElement).value.trim();
                const useId = (this.root.querySelector('#useId') as HTMLInputElement).checked;
                
                if(useId) {
                    gdrive.directoryId = directory;
                }
                else {
                    gdrive.directory = directory;
                    gdrive.directoryId = '';
                }
        
                //this.root.querySelector('#file-browser-container').innerHTML = '';
                
                // Initialize GDrive with new API key and Client ID
                await gdrive.initGapi(apiKey, clientId);
                // Re-enable the auth button
                authButton.disabled = false;
                authButton.click();
          } else {
                // If the form is not valid, display an alert or a message
                alert('Please fill in all required fields correctly.');
          }
        });
        
        authButton.addEventListener('click', async () => {
            if(!gdrive.isLoggedIn) 
                try {
                    await gdrive.handleUserSignIn();
                    this.folderLists.map((v) => {v();});
                    authButton.disabled = true; // Disable the auth button after sign-in
                } catch (error) {
                    console.error('Error signing in:', error);
                }
            
            //if(gdrive.isLoggedIn) gdrive.createFileBrowser('file-browser-container');
        });



        return ui;
    }

    deinit() {
        for(const key in this.threads) {
            this.threads[key].terminate();
        }
        this.ui.remove();
    }

    //customizable onframe callback
    onframe(now, metadata) {}

    async initThreads(outputWidth, outputHeight, {
        decoderPool=4,
        model=undefined,
        labels=undefined,
        modelName='opt-squeeze.onnx',
        labelsName='squeeze-labels.txt',
        //just single i/o for now
        inputName='data',
        outputName='squeezenet0_flatten0_reshape0'
    }={}) {
        
        // Initialization of threads based on your provided code snippet
        this.threads = await initVideoProcessingThreads(
            decoderPool,
            modelName,
            labelsName,
            inputName,
            outputName,
            outputWidth,
            outputHeight,
            model,
            labels
        );

        this.threads.classifierThread.addCallback((res) => {
            if(!res) return;
            console.timeEnd(`capture and inference ${res.id}`);
            //console.log('classifier thread result: ', res);
            this.visualizeCapture(res);
            this.poolCt--;
        });

        // let cb1 = this.threads.videoDecoderThread.addCallback((res)=>{
        //     //console.log('videoDecoderThread thread result: ', res);
        // });
        // let cb2 = this.threads.poolingThread.addCallback((res)=>{
        //     //console.log('poolingThread result:',res)
        // });
      
    }

    clearCanvases = () => {
        for(let i = 0; i < this.canvasPool.length; i++) {
            this.threads.canvasThread.run({cropIndex:i, delete:true});
            this.root.querySelector('#div'+i)?.remove(); //clear the control div
        }
        this.canvasPool = [];
    }

    folderLists:Function[] = [];

    // Method to get a canvas from the pool or create a new one with the results table to be populated from the thread results
    getOrCreateResultElement(crop) {
        if (this.canvasPool[crop.cropIndex]) {
            let canvas = this.canvasPool[crop.cropIndex];
            return canvas; // Reuse a canvas from the pool
        } else {
            let canvas = document.createElement('canvas') as HTMLCanvasElement;
            canvas.id = 'canvas'+crop.cropIndex;
            canvas.width = crop.outputWidth; canvas.height = crop.outputHeight;


            this.canvasPool.push(canvas);

            let offscreen = canvas.transferControlToOffscreen();
      
            this.threads.canvasThread.run(
              {canvas:offscreen, cropIndex:crop.cropIndex},[offscreen]
            );

            //for visualizing spectrograms
            let canvas2 = document.createElement('canvas') as HTMLCanvasElement;
            canvas2.id = 'canvas2'+crop.cropIndex;
            canvas2.width = crop.outputWidth; canvas2.height = crop.outputHeight;
            canvas2.style.position='absolute';


            let offscreen2 = canvas2.transferControlToOffscreen();
      
            this.threads.canvasThread.run(
              {
                canvas:offscreen2, 
                cropIndex:crop.cropIndex+'s'
                },[
                    offscreen2
                ]
            );

            let canvasDiv = document.createElement('div');
            canvasDiv.id = 'div'+crop.cropIndex;

            let resultElm = document.createElement('image-processor-result') as ImageProcessorResult;
            
            resultElm.cropIndex = crop.cropIndex; //instead of the cropIndex thing we are doing here it would be better to just store the resultElm itself on an object by cropIndex and query the elements that way w/o the convoluted id appending
            resultElm.outputWidth = crop.outputWidth;
            resultElm.outputHeight = crop.outputHeight;

            canvasDiv.appendChild(resultElm);

            let dimensionsLabel = document.createElement('div');
            (this.root.querySelector('#results') as HTMLElement).appendChild(canvasDiv);

            (resultElm.querySelector(`#canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(canvas);
            (resultElm.querySelector(`#canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(canvas2);
            (resultElm.querySelector(`#canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(dimensionsLabel);

            canvas2.style.left = 0+'px';
            canvas2.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            
            // Button for downloading the base canvas
            let downloadBtn = resultElm.querySelector("#save"+crop.cropIndex) as HTMLButtonElement;
            downloadBtn.addEventListener('click', () => this.downloadCanvas('canvas' + crop.cropIndex, crop.cropIndex));
            
            // Button for downloading the spectrum canvas
            let downloadSpectrumBtn = resultElm.querySelector("#savespectrum"+crop.cropIndex) as HTMLButtonElement;
            downloadSpectrumBtn.addEventListener('click', () => {
                let imageName = ((resultElm.querySelector(`#name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString()) + '_spectrum';
                this.downloadCanvas('canvas2' + crop.cropIndex, crop.cropIndex, undefined, imageName);
            });
            downloadSpectrumBtn.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            
            // Download spectral data as csv
            let downloadSpectrumCSVBtn = resultElm.querySelector("#savespectrumcsv"+crop.cropIndex) as HTMLButtonElement;
            downloadSpectrumCSVBtn.addEventListener('click', () => {
                downloadSpectrumCSV();
            });
            downloadSpectrumCSVBtn.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            
            let setBaselineButton = resultElm.querySelector("#setbaseline"+crop.cropIndex) as HTMLButtonElement;
            setBaselineButton.addEventListener('click', () => {
                this.threads.poolingThread.run({command:'baseline', name:crop.name},undefined,true);
                setBaselineButton.disabled = true;
                this.baselineSet = true;
            });
            if(this.baselineSet) setBaselineButton.disabled = true;

            let clearSampleButton = resultElm.querySelector("#clearsample"+crop.cropIndex) as HTMLButtonElement;
            clearSampleButton.addEventListener('click', () => {
                //reset the data structures for this crop
                this.threads.poolingThread.run({command:'delete', name:crop.name}, undefined, true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex},undefined,true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex+'s'},undefined,true);
                (this.root.querySelector('#label'+crop.cropIndex) as HTMLElement).innerText = '';
            
            });

            let clearBaselineButton = resultElm.querySelector("#clearbaseline"+crop.cropIndex) as HTMLButtonElement;
            clearBaselineButton.addEventListener('click', () => {
                //reset the data structures for this crop
                this.threads.poolingThread.run({command:'reset', name:crop.name}, undefined, true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex},undefined,true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex+'s'},undefined,true);
                (this.root.querySelector('#label'+crop.cropIndex) as HTMLElement).innerText = '';
                setBaselineButton.disabled = false;
                this.baselineSet = false;
            });

           
            let getSpectralCSV = async () => {
                const command = this.useAveraging ? 'getspectralaveraged' : 'getspectral';
                let result = await this.threads.poolingThread.run({command, name:crop.name}, undefined, true);
                if(!result?.spectral) return {processed:'', csvName:''};
                const spectralData = result.spectral;
                let csvName = (resultElm.querySelector(`#name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString();
                let processed = "Intensity,R,G,B\n";
                for(const value of spectralData.intensities) {
                    processed += `${value.i},${value.r},${value.g},${value.b}\n`;
                }

                return {processed, csvName};
            }

            let downloadSpectrumCSV = async () => {
                let {processed, csvName} = await getSpectralCSV();
                if(processed && csvName) CSV.saveCSV(processed, csvName);
            }


            let folderspan = resultElm.querySelector('#folderspan'+crop.cropIndex) as HTMLElement;
            let folders = resultElm.querySelector('#folderselect'+crop.cropIndex) as HTMLSelectElement;
            let foldername = resultElm.querySelector('#foldername'+crop.cropIndex) as HTMLInputElement;
                                
            let lastv;
            let listFolders = () => {
                if(gdrive.isLoggedIn) {
                    folderspan.style.display = '';
                    gdrive.listFolders().then((list) => {
                        let map = list.map((folder) => {
                            return `<option value="${folder.id}" ${lastv === folder.name ? 'selected' : ''}>${folder.name}</option>`
                        }) as string[];
                        folders.innerHTML += `${map.join('')}`;
                    });
                    let createfolderspan = resultElm.querySelector('#createfolderspan'+crop.cropIndex) as HTMLSpanElement;
                    folders.onchange = (ev:any) => {
                        if(ev.target.value === "new") {
                            createfolderspan.style.display = '';    
                        } else {
                            createfolderspan.style.display = 'none';  
                        }
                    }

                    (resultElm.querySelector('#createfolder'+crop.cropIndex) as HTMLButtonElement).onclick = () => {
                        if(foldername.value) {
                            let v = foldername.value;
                            foldername.value = "";
                            folders.value = ""; createfolderspan.style.display = 'none';
                            gdrive.checkFolder(v, undefined, undefined, gdrive.directoryId).then((folder:any)=>{
                                lastv = folder.name;
                                listFolders();
                            });
                        }
                    }
                }
            }

            this.folderLists[crop.cropIndex] = listFolders;

            if(!gdrive.isLoggedIn) folderspan.style.display = 'none';
            else listFolders();

            //google drive/cloud upload feature. In this example we can specify a subfolder to write to (or add one), then upload the image or other files directly
            let backupToCloud = resultElm.querySelector('#backuptocloud'+crop.cropIndex) as HTMLButtonElement;
            backupToCloud.addEventListener('click', async () => {
                backupToCloud.disabled = true;
                backupToCloud.innerHTML = '...';
                try {

                    let imageName = (resultElm.querySelector(`#name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString();
                    
                    let files = [] as any[];
                    if(this.useSpectralAnalysis.checked) {
                        //we need to get the image and the spectrum csv and whatever else then upload the files to drive
                        let {processed, csvName} = await getSpectralCSV();

                        //this gets the line image
                        let img2 = await this.getCanvasBlob(
                            'canvas2'+crop.cropIndex
                        ); //get png

                        files.push(
                            {
                                name:csvName,
                                mimeType:'text/csv',
                                data:processed
                            },
                            {
                                name:imageName+'_spectral',
                                mimeType:'image/png',
                                data:img2
                            }
                        );
                    }
                    //upload this to drive as a csv
                    
                    //now do the same for the image file
                    let img = await this.getCanvasBlob(
                        'canvas'+crop.cropIndex
                    ); //get png//now do the same for the image file

                    files.push(
                        {
                            name:imageName,
                            mimeType:'image/png',
                            data:img
                        }
                    );

                    if(folders.value && folders.value !== 'new') {
                        files.forEach((file:any) => {
                            file.parents = [folders.value];
                        })
                    }

                    if(!this.gdrive.isLoggedIn) {
                        await this.gdrive.handleUserSignIn(); 
                        this.folderLists.map((v) => {v();});
                    }
                    if(this.gdrive.isLoggedIn) await this.gdrive.uploadFiles(files);
                    else alert("Not Logged In!");
                } catch(er) {
                    console.error("cloud backup error: ",er);
                }
             
                backupToCloud.disabled = false;
                backupToCloud.innerHTML = '☁️🔼'; // Replace with actual icons
            });


        }
    }

    getCanvasBlob(canvasId, format='image/png', cb=(blob)=>{}):Promise<Blob> {
        let canvas = this.root.querySelector('#'+canvasId) as HTMLCanvasElement;
        return new Promise((res,rej) => {
            if (canvas) {
                canvas.toBlob((blob) => {
                    cb(blob);
                    res(blob as Blob);
                }, format);
            } else rej("No canvas selected");
        })
    }
    
    downloadCanvas(canvasId, cropIndex, format='image/png', imageName=(this.root.querySelector(`#name${cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString()) {
        this.getCanvasBlob(
            canvasId, 
            format,
            (blob) => {
                let link = document.createElement('a');
                link.download = imageName + '.png';
                link.href = URL.createObjectURL(blob as Blob);
                link.click();
                URL.revokeObjectURL(link.href); // Clean up the URL object
            }
        );
    }

    clearExcessCanvases = () => {
        if(this.canvasPool.length > (this.BBTool.boxes.length || 1)) { //preserve the first canvas
            for(let i = (this.BBTool.boxes.length || 1); i < this.canvasPool.length; i++) {
                this.threads.canvasThread.run({cropIndex:i, delete:true});
                this.threads.canvasThread.run({cropIndex:i+'s', delete:true});
                this.root.querySelector('#div'+i)?.remove(); //clear the control div
            }
            this.canvasPool.length = (this.BBTool.boxes.length || 1);
        }
    }

    getBoundingBoxData = () => {
        this.clearExcessCanvases();
        
        return this.BBTool.boxes.map((box,i) => {
            return {
                name:`${i}`,
                id:`${Math.floor(Math.random()*1000000000000000)}`,
                cropX:box.rect.x,
                cropY:box.rect.y,
                cropW:box.rect.width,
                cropH:box.rect.height,
                outputWidth:this.outputWidth,
                outputHeight:this.outputHeight,
                cropIndex:i
            };
        });
    }

    processBoundingBoxes = async (
        render=true, //run render thread(s)
        classify=true, //run classifier thread(s)
        data=this.getBoundingBoxData()
    ) => {
        // Here we would capture the frame data related to the bounding box
        // However, the specifics of how to capture and process the frame depend on your application's logic
        if(!this.Media.currentMediaElement) return;
        // For demonstration, we'll assume we have a function to capture the frame
        const timestamp = (this.Media.currentMediaElement as HTMLVideoElement).currentTime || Date.now();
        const frame = new VideoFrame(this.Media.currentMediaElement, {timestamp:Date.now()});
        
        if(data.length === 0) {
            const sourceWidth = (this.Media.currentMediaElement as HTMLImageElement).naturalWidth || (this.Media.currentMediaElement as HTMLVideoElement).videoWidth || this.Media.currentMediaElement.width;
            const sourceHeight = (this.Media.currentMediaElement as HTMLImageElement).naturalHeight || (this.Media.currentMediaElement as HTMLVideoElement).videoHeight || this.Media.currentMediaElement.height;
        
            data.push({
                name:`0`,
                id:`${Math.floor(Math.random()*1000000000000000)}`,
                cropX:0,
                cropY:0,
                cropW:sourceWidth,
                cropH:sourceHeight,
                outputWidth:this.outputWidth,
                outputHeight:this.outputHeight,
                cropIndex:0
            });
        }

        if(classify) {
            if(this.threadRunning && this.classifierWait) 
                await this.classifierWait; //make sure classifierThread finishes last round.    
            else if(this.poolCt >= this.poolCtMaxIdx) { //we need to await this last promise;
                this.classifierWait = new Promise((res) => {
                    let id = this.threads.classifierThread.addCallback(() => {
                        if(this.poolCt === 0) { //wait for flush
                            this.threads.classifierThread.removeCallback(id);
                            this.threadRunning = false;
                            this.classifierWait = undefined; //dereference for next frame
                            res(true);
                        }
                    });
                });
                this.threadRunning = true;
            }
        }

        //we are grabbing the whole frame and then if subframes are specified we process a whole array as cropped images
        let toDecode = {
            image:frame,
            id:`${Math.floor(Math.random()*1000000000000000)}`,
            width:(this.Media.currentMediaElement as HTMLVideoElement).videoWidth || (this.Media.currentMediaElement as HTMLImageElement).naturalWidth || this.Media.currentMediaElement.width,
            height:(this.Media.currentMediaElement as HTMLVideoElement).videoHeight || (this.Media.currentMediaElement as HTMLImageElement).naturalHeight || this.Media.currentMediaElement.height,
            command:this.useAveraging.checked ? 'setaveraged' : 'set',
            timestamp,
            data,
            overridePort:true,
            //autocor:this.useAutocor.checked,
            spectral:this.useSpectralAnalysis.checked
        };

        for(const crop of data) {
            console.time(`capture and inference ${crop.id}`);
            if(classify) this.poolCt++;
        }

        return await new Promise((res,rej) => {

            let id = this.threads.poolingThread.addCallback((out) => {
                if(out === toDecode.id) {
                    this.threads.poolingThread.removeCallback(id);
                    
                    for(const crop of data) { //classify each crop
    
                        if(classify) {
                            this.getOrCreateResultElement(crop);
    
                            if(this.selectedInput === 'spectral') {
                                const command = this.useAveraging ? 'getspectralaveraged' : 'getspectral';
                                this.threads.poolingThread.run(
                                    {
                                        command, 
                                        name:crop.name,
                                        input:this.selectedInput
                                    }, 
                                    undefined, 
                                    this.threads.classifierThread.id
                                );
                            } else {
                                this.threads.poolingThread.run(
                                    {
                                        command:'get',
                                        name:crop.name,
                                        input:this.selectedInput
                                    },
                                    undefined, 
                                    this.threads.classifierThread.id
                                );
                            }
                                
                        }
            
                        if(render) {
                            const command1 = this.useAveraging ? 'getbmpaveraged' : 'getbmp';
                            this.threads.poolingThread.run(
                                {
                                    command:command1, //getbmpaveraged //this.useAutocor.checked ? 'getautocorbmp' : 
                                    name:crop.name
                                }, 
                                undefined, 
                                this.threads.canvasThread.id
                            );
        
                            if(this.useSpectralAnalysis.checked) {
                                const command2 = this.useAveraging ? 'getspectralaveraged' : 'getspectral';
                                this.threads.poolingThread.run(
                                    {
                                        command:command2, 
                                        name:crop.name
                                    }, 
                                    undefined, 
                                    this.threads.canvasThread.id
                                );
                            }
                        }
                    }

                    res(true);
                }
            });
                
            // Send the frame data to the videoDecoderThread for processing
            this.threads.videoDecoderThread.run(toDecode,[frame]);
        
        });
    }

    visualizeCapture(
        result?:{
            inferenceTime:number,
            avgFrameTime:number,
            avgFrameRate:number,
            height:number,
            width:number,
            name:string,
            id:string,
            cropIndex:number,
            label:string,
            maxProb:number,
            probs:number[]
        }
    ) {
      
        if(result) {
            //@ts-ignore
            (this.root.querySelector('#name'+result.cropIndex) as HTMLInputElement).value = result?.label ? result?.label.replaceAll(' ','_') : result?.name;
            (this.root.querySelector('#label'+result.cropIndex) as HTMLElement).innerText = result?.label;
            (this.root.querySelector('#maxProb'+result.cropIndex) as HTMLElement).innerText = result?.maxProb?.toFixed(3) as any;
            (this.root.querySelector('#inferenceTime'+result.cropIndex) as HTMLElement).innerText = result?.inferenceTime?.toFixed(3) as any;
            //(this.root.querySelector('#setbaseline'+result.cropIndex) as HTMLButtonElement).disabled = false;
            
            if(this.BBTool.boxes[parseInt(result.name)]?.id) 
                this.BBTool.updateLabelProgrammatically(
                    this.BBTool.boxes[parseInt(result.name)].id, result.label
                );
      
            //TempCanvases[name] = div;
      
            //folderContents.insertAdjacentElement('afterbegin',div);
        }
    }

    // Other methods to handle threading callbacks and aggregation...
}

export default ImageProcessor;





class ImageProcessorResult extends HTMLElement {
    
    cropIndex:string|number; outputWidth:string|number; outputHeight:string|number;


    constructor() {
        super();
    }

    static observedAttributes = ['cropIndex', 'outputWidth', 'outputHeight'];

    // // Respond to attribute changes
    // attributeChangedCallback(name, oldValue, newValue) {
    //     if (this.isConnected) { // Check if element is in the DOM
    //         this.updateContent();
    //     }
    // }

    // Called every time the element is inserted into the DOM
    connectedCallback() {
        this.render();
        this.updateContent();
    }

    // disconnectedCallback() {
    //     console.log("Custom element removed from page.");
    // }
    
    // adoptedCallback() {
    //     console.log("Custom element moved to new page.");
    // }

    // Render method to provide the base HTML
    render() {
        this.innerHTML = resulthtml;
    }

    // Dynamically update content and IDs based on cropIndex
    updateContent() {
        const cropIndex = this.cropIndex || 0;
        const outputWidth = this.outputWidth || 0;
        const outputHeight = this.outputHeight || 0;

        // Query all elements that require ID updates
        this.querySelectorAll('[id]').forEach(el => {
            // Check if the ID already ends with a number
            el.id = `${el.id}${cropIndex}`; // Append with new cropIndex
        });

        // Update dimensions label specially
        const dimensionsLabel = this.querySelector('.image-processor-dimensions-label');
        if (dimensionsLabel) {
            dimensionsLabel.innerHTML = `${outputWidth}x${outputHeight}`;
        }
    }
}

// Define the new element
customElements.define('image-processor-result', ImageProcessorResult);