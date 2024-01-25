// ImageProcessor.ts
import { BoundingBoxTool } from "./image_utils/boundingBoxTool";
import { MediaElementCreator } from "./image_utils/MediaElementCreator";
import { CamThreads, initVideoProcessingThreads } from "./camThreads";
import { CSV } from './data_util/csv'

import './lib/modalbutton' //<modal-button></modal-button>

import './imageprocessor_component'
import {ImageProcessorComponent} from  './imageprocessor_component'


        
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
            modelName:'pipeline_xgboost_spectrum.onnx',
            labelsName:'fish-labels.txt',
            inputName:'input',
            outputName:'output',
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
    selectedInput = 'spectral' //'spectral','imageflattened','image'

    gdrive:GDrive;



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
                textElm.innerText = `${element.videoWidth || element.naturalWidth || element.width}x${element.videoHeight || element.naturalHeight || element.height}`;
            },300);
            console.log('Stream target changed with ID or URL:', id);
        };

        
        this.container = this.root.querySelector(`#container`) as HTMLElement;
        this.streamVideo = this.root.querySelector(`#streamvideo`) as HTMLInputElement;

        this.useSpectralAnalysis = this.root.querySelector(`#spectral`) as HTMLInputElement;
        //this.useAutocor = this.parentElement.querySelector(`#autocorrelate${this.id}`) as HTMLInputElement;
        //this.usePano = this.parentElement.querySelector(`#pano${this.id}`) as HTMLInputElement;
        this.useAveraging = this.root.querySelector(`#average`) as HTMLInputElement;
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
        captureButton.onclick = () => {

            // Add the active class to trigger the animation
            captureButton.classList.add('capture-btn-active');

            this.processBoundingBoxes();

            // Reattach the click event listener after the animation ends
            captureButton.addEventListener('animationend', () => {
                // Remove the active class after the animation
                captureButton.classList.remove('capture-btn-active');
            });
        };



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

            canvasDiv.innerHTML = `
                <table class="image-processor-table">
                    <tr>
                        <td class="image-processor-media" id="canvasContainer${crop.cropIndex}">
                            <span id="label${crop.cropIndex}" class="image-processor-label"></span>
                            <span class="image-processor-dimensions-label">${crop.outputWidth}x${crop.outputHeight}</span>
                        
                        </td>
                        <td id="output${crop.cropIndex}">
                            <table class="image-processor-table">
                                <tr class="image-processor-table-header">
                                    <td colSpan="1" class="image-processor-table-cell">
                                        <input type="text" id="name${crop.cropIndex}" placeholder="Image Name">.png
                                        <hr/>
                                    </td>
                                </tr>
                                <tr class="image-processor-table-header">
                                    <td id="imgheadercell${crop.cropIndex}" class="image-processor-table-cell"></td>
                                </tr>    
                                <tr class="image-processor-table-header">
                                    <td class="image-processor-table-cell">
                                        <hr/>
                                        <table>
                                            <tr><td>
                                            Probability: <span id="maxProb${crop.cropIndex}" ></span>
                                            <hr/>
                                            </td></tr>
                                            <tr><td>
                                            GPU Time (ms): <span id="inferenceTime${crop.cropIndex}" ></span>
                                            </td></tr>
                                        </table>
                                    </td> 
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            `;

            let dimensionsLabel = document.createElement('div');
            (this.root.querySelector('#results') as HTMLElement).appendChild(canvasDiv);
            (this.root.querySelector(`#canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(canvas);
            (this.root.querySelector(`#canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(canvas2);
            (this.root.querySelector(`#canvasContainer${crop.cropIndex}`) as HTMLElement).appendChild(dimensionsLabel);

            canvas2.style.left = 0+'px';
            canvas2.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            let appendTo = (this.root.querySelector('#imgheadercell'+crop.cropIndex) as HTMLElement);

            // Button for downloading the base canvas
            let downloadDiv = document.createElement('div');
            let downloadBtn = document.createElement('button');
            downloadBtn.id = "save"+crop.cropIndex;
            downloadBtn.innerHTML = '💾'; 
            downloadBtn.addEventListener('click', () => this.downloadCanvas('canvas' + crop.cropIndex, crop.cropIndex));
            downloadBtn.title = "Download Image";

            // Button for downloading the spectrum canvas
            let downloadSpectrumBtn = document.createElement('button');
            downloadSpectrumBtn.id = "savespectrum"+crop.cropIndex;
            downloadSpectrumBtn.innerHTML = '💾🌈'; // Replace with actual icons
            downloadSpectrumBtn.addEventListener('click', () => {
                let imageName = ((this.root.querySelector(`#name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString()) + '_spectrum';
                this.downloadCanvas('canvas2' + crop.cropIndex, crop.cropIndex, undefined, imageName);
            });
            downloadSpectrumBtn.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            downloadSpectrumBtn.title = "Download Spectrum Image";

            // Download spectral data as csv
            let downloadSpectrumCSVBtn = document.createElement('button');
            downloadSpectrumCSVBtn.id = "savespectrumcsv"+crop.cropIndex;
            downloadSpectrumCSVBtn.innerHTML = '💾📉'; // Replace with actual icons
            downloadSpectrumCSVBtn.addEventListener('click', () => {
                downloadSpectrumCSV();
            });
            downloadSpectrumCSVBtn.style.display = this.useSpectralAnalysis.checked ? '' : 'none';
            downloadSpectrumCSVBtn.title = "Download Spectrum CSV";

            let setBaselineButton = document.createElement('button');
            setBaselineButton.id = "setbaseline"+crop.cropIndex;
            setBaselineButton.innerHTML = '⛳'; // Replace with actual icons
            setBaselineButton.addEventListener('click', () => {
                this.threads.poolingThread.run({command:'baseline', name:crop.name},undefined,true);
                setBaselineButton.disabled = true;
            });
            setBaselineButton.title = "Set as Baseline";

            let clearSampleButton = document.createElement('button');
            clearSampleButton.id = "clearsample"+crop.cropIndex;
            clearSampleButton.innerHTML = '🆑'; // Replace with actual icons
            clearSampleButton.addEventListener('click', () => {
                //reset the data structures for this crop
                this.threads.poolingThread.run({command:'delete', name:crop.name}, undefined, true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex},undefined,true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex+'s'},undefined,true);
                (this.root.querySelector('#label'+crop.cropIndex) as HTMLElement).innerText = '';
            
            });
            clearSampleButton.title = "Clear Sample Data for Next Pass";

            let clearBaselineButton = document.createElement('button');
            clearBaselineButton.id = "clearbaseline"+crop.cropIndex;
            clearBaselineButton.innerHTML = '🆑⛳'; // Replace with actual icons
            clearBaselineButton.addEventListener('click', () => {
                //reset the data structures for this crop
                this.threads.poolingThread.run({command:'reset', name:crop.name}, undefined, true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex},undefined,true);
                this.threads.canvasThread.run({clear:true,   cropIndex:crop.cropIndex+'s'},undefined,true);
                (this.root.querySelector('#label'+crop.cropIndex) as HTMLElement).innerText = '';
            
            });
            clearBaselineButton.title = "Clear Baseline Averaging Data";

           
            let getSpectralCSV = async () => {
                let result = await this.threads.poolingThread.run({command:'getspectral', name:crop.name}, undefined, true);
                if(!result?.spectral) return {processed:'', csvName:''};
                const spectralData = result.spectral;
                let csvName = (this.root.querySelector(`#name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString();
                let processed = "Intensity,R,G,B\n";
                for(const value of spectralData.intensities) {
                    processed += `${value.i},${value.r},${value.g},${value.b}\n`;
                }

                return {processed, csvName};
            }

            //TODO: Spectrum CSV (pull from poolingThread with getspectral:true and overridePort:true)
            let downloadSpectrumCSV = async () => {
                let {processed, csvName} = await getSpectralCSV();
                if(processed && csvName) CSV.saveCSV(processed, csvName);
            }


            //google drive/cloud upload feature. In this example we can specify a subfolder to write to (or add one), then upload the image or other files directly
            let backupToCloud = document.createElement('button');
            backupToCloud.id = "backupToCloud"+crop.cropIndex;
            backupToCloud.innerHTML = '☁️🔼'; // Replace with actual icons
            backupToCloud.addEventListener('click', async () => {
                backupToCloud.disabled = true;
                backupToCloud.innerHTML = '...';
                try {
                    //we need to get the image and the spectrum csv and whatever else then upload the files to drive
                    let {processed, csvName} = await getSpectralCSV();
                    //upload this to drive as a csv
                    
                    //now do the same for the image file
                    let img = await this.getCanvasBlob(
                        'canvas'+crop.cropIndex
                    ); //get png

                    let imageName = (this.root.querySelector(`#name${crop.cropIndex}`) as HTMLInputElement).value || 'image_'+new Date().toISOString();
                    let files = [
                        {
                            name:csvName,
                            mimeType:'text/csv',
                            data:processed
                        },
                        {
                            name:imageName,
                            mimeType:'image/png',
                            data:img
                        }
                    ];

                    if(!this.gdrive.isLoggedIn) await this.gdrive.handleUserSignIn(); 
                    if(this.gdrive.isLoggedIn) await this.gdrive.uploadFiles(files);
                    else alert("Not Logged In!");
                } catch(er) {
                    console.error("cloud backup error: ",er);
                }
             
                backupToCloud.disabled = false;
                backupToCloud.innerHTML = '☁️🔼'; // Replace with actual icons
            });

            backupToCloud.title = "Backup to Cloud";

            //todo disable after clear then reenable on new data
            downloadDiv.appendChild(setBaselineButton);
            downloadDiv.appendChild(downloadBtn);
            downloadDiv.appendChild(downloadSpectrumBtn);
            downloadDiv.appendChild(downloadSpectrumCSVBtn);
            downloadDiv.appendChild(backupToCloud);
            downloadDiv.appendChild(clearSampleButton);
            downloadDiv.appendChild(clearBaselineButton);

            appendTo.appendChild(downloadDiv);
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

        if(this.classifierWait) 
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
            this.poolCt++;
                        }
        let id = this.threads.poolingThread.addCallback((out) => {
            if(out === toDecode.id) {
                this.threads.poolingThread.removeCallback(id);
    
                for(const crop of data) { //classify each crop

                    this.getOrCreateResultElement(crop);

                    if(this.selectedInput === 'spectral') {
                        this.threads.poolingThread.run(
                            {
                                command:'getspectral', 
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
        
                    this.threads.poolingThread.run(
                        {
                            command:'getbmp', //this.useAutocor.checked ? 'getautocorbmp' : 
                            name:crop.name
                        }, 
                        undefined, 
                        this.threads.canvasThread.id
                    );

                    if(this.useSpectralAnalysis.checked) {
                        this.threads.poolingThread.run(
                            {
                                command:'getspectral', 
                                name:crop.name
                            }, 
                            undefined, 
                            this.threads.canvasThread.id
                        );
                    }
                }
            }
        });
            
        // Send the frame data to the videoDecoderThread for processing
        this.threads.videoDecoderThread.run(toDecode,[frame]);
    
        return true;
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
            (this.root.querySelector('#setbaseline'+result.cropIndex) as HTMLButtonElement).disabled = false;
            
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

