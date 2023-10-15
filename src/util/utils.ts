
import {Math2} from 'brainsatplay-math'
import { readFileAsText, writeFile } from "./BFSUtils";
import { CSV } from "./csv";

export function isMobile() {
    let check = false;
    (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substr(0,4))) check = true;})(navigator.userAgent||navigator.vendor||(window as any).opera);
    return check;
};

export function isAndroid() { //https://stackoverflow.com/questions/6031412/detect-android-phone-via-javascript-jquery
    const device = navigator.userAgent.toLowerCase();
    return device.indexOf("android") > -1; 
}

export function downloadMP4URL(videoURL, title=new Date().toISOString()) {
    var hiddenElement = document.createElement('a');
    hiddenElement.href = videoURL;
    hiddenElement.target = "_blank";
    if (title !== "") {
        hiddenElement.download = title+".mp4";
    } else{
        hiddenElement.download = new Date().toISOString()+".mp4";
    }
    hiddenElement.click();
}

function downloadURL(url, name = null) {
    const a = document.createElement('a')
    a.href = url
    a.download = name ?? ''
    a.click()
}

//capture a video clip for playback, we should save the video 
//clip in these cases and reprocess instead of keeping giant bitmap 
//collections except as needed
export function recordCanvas(canvas, fps=30, withVideoURL=downloadMP4URL, nSec=null) { //can specify number of seconds to record after calling start();
    let videoSrc = canvas.captureStream(fps) as MediaStream;
    let mediaRecorder = new MediaRecorder(videoSrc); //https://medium.com/@amatewasu/how-to-record-a-canvas-element-d4d0826d3591

    let chunks = [] as any[];
    mediaRecorder.ondataavailable = function(e) {
        chunks.push(e.data);
    }

    mediaRecorder.onstop = function(e) {
        let blob = new Blob(chunks, {'type':'video/mp4'});
        chunks = [];
        let videoURL = URL.createObjectURL(blob);
        withVideoURL(videoURL);
    }
    
    if(nSec) {
        mediaRecorder.onstart = (e) => {        
            setTimeout(()=>{
                try{ mediaRecorder.stop(); } catch(err) {}
            },nSec*1000);
        }
    }

    return mediaRecorder;

}




export function drawImage(
    context,
    img,
    sx0=0,
    sy0=0,
    sw=img.width,
    sh=img.height,
    dx0=0,
    dy0=0,
    dw=context.canvas.width,
    dh=context.canvas.height
) {
    return context.drawImage(img,sx0,sy0,sw,sh,dx0,dy0,dw,dh);
}



//if we're clicking on a canvas and want to scale the coordinates to the image (which may be squashed or stretched to the canvas in html)
export function overlayToImgPicker(img, canvasOverlay, canvasX, canvasY, imgOffsetX=0, imgOffsetY=0) {
    if(img.naturalWidth) {
        return {
            x: Math.round(img.naturalWidth * (canvasX - imgOffsetX)/canvasOverlay.width),
            y: Math.round(img.naturalHeight * (canvasY - imgOffsetY)/canvasOverlay.height)
        };
    } else if (img.videoWidth) {
        return {
            x: Math.round(img.videoWidth * (canvasX - imgOffsetX)/canvasOverlay.width),
            y: Math.round(img.videoHeight * (canvasY - imgOffsetY)/canvasOverlay.height)
        };
    } else if (img.width) {
        return {
            x: Math.round(img.width * (canvasX - imgOffsetX)/canvasOverlay.width),
            y: Math.round(img.height * (canvasY - imgOffsetY)/canvasOverlay.height)
        } //what I should do is account for a potentially offset image inside a canvas (e.g. if you want multiple images in a canvas)
    }

    return undefined;
} 

export function imgToOverlayPicker(img, canvasOverlay, imgX, imgY, imgOffsetX=0, imgOffsetY=0) {
    if(img.naturalWidth) {
        return {
            x: Math.round(canvasOverlay.width * (imgX - imgOffsetX)/img.naturalWidth),
            y: Math.round(canvasOverlay.height * (imgY - imgOffsetY)/img.naturalHeight)
        };
    } else if (img.videoWidth) {
        return {
            x: Math.round(canvasOverlay.width * (imgX - imgOffsetX)/img.videoWidth),
            y: Math.round(canvasOverlay.height * (imgY - imgOffsetY)/img.videoHeight)
        };
    } else if (img.width) {
        return {
            x: Math.round(canvasOverlay.width * (imgX - imgOffsetX)/img.width),
            y: Math.round(canvasOverlay.height * (imgY - imgOffsetY)/img.height) 
        } //what I should do is account for a potentially offset image inside a canvas (e.g. if you want multiple images in a canvas)
    }

    return undefined;
} 


export async function captureBitmap(img, x0=0, y0=0, w, h) {

    if(!w || !h) {
        if(img.naturalWidth) {
            w = img.naturalWidth;
            h = img.naturalHeight;
        } else if (img.videoWidth) {
            w=img.videoWidth;
            h=img.videoHeight;
        } else {
            w = img.width;
            h = img.height;
        }
    }

    return await createImageBitmap(img, x0, y0, w+1, h+1);
}

export function getCanvasBitmap(context,x0=0,y0=0,w=context.canvas.width,h=context.canvas.height) {
    return context.getImageData(x0,y0,w,h);
}

export function getMaxima(xrgbintensities=[{r:0,g:0,b:0,i:0}]) {
    let xintmax  = Math.max(...xrgbintensities.map((x) => {return x.i}));
    let xrintmax = Math.max(...xrgbintensities.map((x) => {return x.r}));
    let xbintmax = Math.max(...xrgbintensities.map((x) => {return x.b}));
    let xgintmax = Math.max(...xrgbintensities.map((x) => {return x.g}));

    let xrgbmax  = Math.max(xrintmax,xbintmax,xgintmax);

    return {
        xintmax,
        xrintmax,
        xbintmax,
        xgintmax,
        xrgbmax
    }
}

//pass context.getImageData() result
export function mapBitmapXIntensities(bitmapImageData) {
    let bitarr = Array.from(bitmapImageData.data) as any[];

    //intensities along the x axis (summing the y column image data)
    let xrgbintensities = [] as any[];
    let i = [] as any[];
    let r = [] as any[];
    let g = [] as any[];
    let b = [] as any[];

    let x = 0;

    //srgb format
    for(let j = 0; j < bitarr.length; j+=4) {
        if((j/4) % bitmapImageData.width === 0) x = 0;

        if(!i[x]) {
            i[x]=parseFloat(bitarr[j]+bitarr[j+1]+bitarr[j+2]),
            r[x]=parseFloat(bitarr[j]),
            g[x]=parseFloat(bitarr[j+1]),
            b[x]=parseFloat(bitarr[j+2])
        }
        else {
            i[x] += parseFloat(bitarr[j]+bitarr[j+1]+bitarr[j+2]);
            r[x] += parseFloat(bitarr[j]);
            g[x] += parseFloat(bitarr[j+1]);
            b[x] += parseFloat(bitarr[j+2]);
        }
        x++;
    }

    function clamp(arr,max=Math.max(...arr)) { //Clamp array to max (assuming all positive and absolute values are relative to the sensor)
        if(!max) max = Math.max(...arr);

        return arr.map(v => v/max);
    }

    //we need to normalize the arrays
    let max =  Math.max(...i);
    i = clamp(i,max);
    r = clamp(r,max);
    g = clamp(g,max);
    b = clamp(b,max);

    xrgbintensities = i.map((v,j) => {
        return {
            i:i[j],
            r:r[j],
            g:g[j],
            b:b[j]
        }
    })
    

    let xintmax  = Math.max(...xrgbintensities.map((x) => {return x.i}));
    let xrintmax = Math.max(...xrgbintensities.map((x) => {return x.r}));
    let xbintmax = Math.max(...xrgbintensities.map((x) => {return x.b}));
    let xgintmax = Math.max(...xrgbintensities.map((x) => {return x.g}));

    let xrgbmax  = Math.max(xrintmax,xbintmax,xgintmax);

    return {
        bitmap:bitmapImageData, 
        width:bitmapImageData.width,
        height:bitmapImageData.height,
        bitarr:bitarr, //generic array you can read/write normally
        xrgbintensities, //rgb intensities summed for each component and together (rgbi)
        xintmax, //max of total intensities for scaling
        xrintmax, //max of r intensities
        xbintmax, //max of b intensities
        xgintmax, //max of g intensities
        xrgbmax //max of rgb intensities (not the i which is a much larger number)
    }
}

export async function autocorrelateImage(bitmapImageDataArray,imageWidth,imageHeight) {
    let arr = Array.from(bitmapImageDataArray);
    
    let bmp = {
        r:[[]],g:[[]],b:[[]],s:[[]]
    } as any;
    let x = 0;
    let y = 0;
    arr.forEach((v,i)=> {
        if(i%4 == 0 || i == 0 )
            bmp.r[y].push(v);
        else if ((i-1)%4 == 0 || i == 1)
            bmp.g[y].push(v);
        else if ((i-2)%4 == 0 ||i == 2)
            bmp.b[y].push(v);
        else if ((i-3)%4 == 0 || i == 3) {
            bmp.s[y].push(v);
            x++;

            if(x == imageWidth) {
                x = 0;
                y++;
                if(y !== imageHeight) {
                    bmp.r.push([]); bmp.g.push([]); bmp.b.push([]); bmp.s.push([]);
                }
            }
        }
        // if(i == 0 || i%4 == 0)
        //     bmp[pidx] = { r:v };
        // else if (i == 1 || (i-1)%4 == 0)
        //     bmp[pidx].g = v;
        // else if (i == 2 || (i-2)%4 == 0)
        //     bmp[pidx].b = v;
        // else if (i == 3 || (i-3)%4 == 0) {
        //     bmp[pidx].s = v;
        //     pidx++;
        // }
    });

    let res = {
        r:undefined,g:undefined,b:undefined,s:undefined
    } as any;


    //console.log(bmp.r,bmp.g,bmp.b,bmp.s);
    res.r = Math2.autocorrelation2d(bmp.r);
    res.g = Math2.autocorrelation2d(bmp.g);
    res.b = Math2.autocorrelation2d(bmp.b);
    res.s = bmp.s;//Math2.autocorrelation2dNormalized(bmp.s);

    //return res;

    let resultsconcat = {r:[],g:[],b:[],s:[]} as any;

    res.r.forEach(a => resultsconcat.r.push(...a))
    res.g.forEach(a => resultsconcat.g.push(...a))
    res.b.forEach(a => resultsconcat.b.push(...a))

    resultsconcat.r = Math2.normalizeSeries(resultsconcat.r,true).map(v => v*255);
    resultsconcat.g = Math2.normalizeSeries(resultsconcat.g,true).map(v => v*255);
    resultsconcat.b = Math2.normalizeSeries(resultsconcat.b,true).map(v => v*255);
    
    let reconstructed = [] as any[];

    resultsconcat.r.forEach((v,i)=> {
        reconstructed.push(v,resultsconcat.g[i],resultsconcat.b[i],255);
    })

    // res.r.forEach((p,i) => {
    //     p.forEach((v,j) => {
    //         reconstructed.push(v,res.g[i][j],res.b[i][j],0);
    //     })
    // })

    // reconstructed = Math2.normalizeSeries(reconstructed,true).map((v,i) => {
    //     if(i === 3 || (i-3)%4 === 0) {
    //         return 255;
    //     }
    //     else return v*255        
    // })

    console.log('reconstructed',reconstructed)

    return Uint8ClampedArray.from(reconstructed);

    // return new ImageData(uintarr,bitmapImageData.width,bitmapImageData.height);

}

export function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i++)
        bytes[i] = binary.charCodeAt(i);
    return bytes;
}


export const b64toBlob = (b64Data, contentType='', sliceSize=512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays = [] as any[];
  
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
  
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
  
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
  
    const blob = new Blob(byteArrays, {type: contentType});
    return blob;
  }

//browserfs back up our results from mapBitmapXIntensities to browserfs local indexeddb
export async function backupData(mapBitmapXIntensitiesResult,title) {
    let res = Object.assign({},mapBitmapXIntensitiesResult);
    delete res.bitmap; //delete the typed array that we can reconstruct later
    let str = JSON.stringify(res);
    return await writeFile(title, str);
}

//pull results from browserfs and reload the bitmap data.
export async function pullBackedUpData(title) {
    let data = await readFileAsText(title);
    let parsed = JSON.parse(data);
    parsed.bitmap = reconstructImageData(parsed.bitarr,parsed.width,parsed.height);
    return parsed;
}

export function reconstructImageData(array, width, height) {
    return new ImageData(Uint8ClampedArray.from(array),width,height)
}

//subtract bitmap1 from bitmap2, bitmaps are ImageData or ImageBitmaps in srgb format. Returns a reconstructed image
export function compareBitmaps(bitmap1,bitmap2) {
    if(bitmap1.width !== bitmap2.width && bitmap1.height !== bitmap2.height) {
        console.error('compared bitmaps must be the same dimensions!')
        return undefined;
    }
    let arr = Array.from(bitmap1.data) as any;
    let arr2 = Array.from(bitmap2.data) as any;
    let res = new Array(arr.length);

    arr.forEach((v,i) => {
        if((i-1)%3 !== 0 || i !== 3) {
            res[i] = arr2[i] - arr[i];
        } else res[i] = v; //ignore the s in rgb in position 4;
    });

    return reconstructImageData(res,bitmap1.width,bitmap1.height);

}

export function graphXIntensities(context, xrgbintensities, xintmax, xintmin, x0=0, y0=0, width=context.canvas.width, height=context.canvas.height) {

    //console.log(xintmax);
    context.fillStyle = 'black';
    if(context.canvas.height)
    context.lineWidth = 2;

    //draw the x axis

    if(!xintmax) {
        xintmax = Math.max(...xrgbintensities.map(y => y.i));
    }
    if(!xintmin) {
        xintmin = Math.min(...xrgbintensities.map(y => y.i));
    }
    if(xintmin > 0) xintmin = 0;

    context.strokeStyle = 'gray';
    context.beginPath();
    let zeroHeight = height*(1-(0-xintmin)/(xintmax-xintmin));
    context.moveTo(0,zeroHeight);
    context.lineTo(width,zeroHeight);
    context.stroke();
    
    let mapped = {
        xrgbintensities,
        xintmax,
        xintmin
    }

    let npixels = mapped.xrgbintensities.length;
    let xscalar = width/npixels;


    context.strokeStyle = 'ghostwhite';
    context.beginPath();

    mapped.xrgbintensities.forEach((yrgbi,i) => {
        if(i === 0) {
            context.moveTo(x0,y0+height*(1-(yrgbi.i - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
        else {
            context.lineTo(x0+i*xscalar,y0+height*(1-(yrgbi.i - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
    });


    context.stroke();
    
    context.strokeStyle = 'tomato';
    context.lineWidth = 2;

    context.beginPath();

    mapped.xrgbintensities.forEach((yrgbi,i) => {
        if(i === 0) {
            context.moveTo(x0,y0+height*(1-(yrgbi.r - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
        else {
            context.lineTo(x0+i*xscalar,y0+height*(1-(yrgbi.r - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
    });

    context.stroke();
    
    context.strokeStyle = '#00b8f5';

    context.beginPath();

    
    mapped.xrgbintensities.forEach((yrgbi,i) => {
        if(i === 0) {
            context.moveTo(x0,y0+height*(1-(yrgbi.b - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
        else {
            context.lineTo(x0+i*xscalar,y0+height*(1-(yrgbi.b - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
    });
    
    context.stroke();
    
    context.strokeStyle = 'chartreuse';

    context.beginPath();
    

    mapped.xrgbintensities.forEach((yrgbi,i) => {
        if(i === 0) {
            context.moveTo(x0,y0+height*(1-(yrgbi.g - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
        else {
            context.lineTo(x0+i*xscalar,y0+height*(1-(yrgbi.g - xintmin)/(mapped.xintmax-mapped.xintmin)));
        }
    });

    context.stroke();
    //update the plot from the bitmap
    
   // console.log(this.bitmap, xintensities, xrgbintensities);
    return mapped;
}

//we have a list of canvases to populate as new captures stream in
//we also have a list on the right side of saved canvases we are comparing
//lets bump off canvases past a certain limit, offscreencanvas?


//return an array estimating the wavelengths of light along the x axis
export function targetSpectrogram(xrgbintensities, xrintmax, xgintmax, xbintmax, peakR=650, peakG=520, peakB=450) {
    let ri, gi, bi;

    xrgbintensities.forEach((x,i) => {
        if(xrintmax === x.r) ri = i;
        if(xgintmax === x.g) gi = i;
        if(xbintmax === x.b) bi = i;
    });

    let spectrumEstimate = new Array(xrgbintensities.length);

    let incr = ((ri - bi)/(peakR - peakB) + (ri-gi)/(peakR-peakG) + (gi-bi)/(peakG-peakB))/3;

    let peaki;

    let peakPeak = Math.max(xrintmax,xgintmax,xbintmax);
    if(peakPeak === xrintmax) {
        peaki = ri;
        spectrumEstimate[peaki] = peakR;
    }
    if(peakPeak === xgintmax) {
        peaki = gi;
        spectrumEstimate[peaki] = peakG;
    }
    if(peakPeak === xbintmax) {
        peaki = bi;
        spectrumEstimate[peaki] = peakB;
    }

    let i = peaki - 1;
    let curWavelength = spectrumEstimate[peaki] - incr;
    while(i >= 0) {
        spectrumEstimate[i] = curWavelength;
        curWavelength -= incr;
        i--;
    }

    let j = peaki + 1;
    curWavelength = spectrumEstimate[peaki] + incr;
    while(j < spectrumEstimate.length) {
        spectrumEstimate[j] = curWavelength;
        curWavelength += incr;
        j++;
    }

    return spectrumEstimate;

}

