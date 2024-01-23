import {ImageProcessor} from './src/ImageProcessor'

import worker from './src/wonnx.worker'
worker;
import './index.css'
import { initPanoTool } from './src/hyperspectral_tool/panotool';

let mode = document.createElement('button');
mode.innerHTML = "Switch to Scanner";
mode.style.position = 'absolute'; mode.style.zIndex = "1000";
mode.style.right = '0'; mode.style.top = '0';

let panotool;

let p = new ImageProcessor();

mode.onclick = () => {
    if(panotool) {
        panotool.deinit();
        panotool = undefined;
        p.init();
        mode.innerHTML = "Switch to Scanner";
    } else {
        p.deinit();
        panotool = initPanoTool();
        mode.innerHTML = "Switch to Classifier";
    }
}

document.body.appendChild(mode);

//mode.click();
