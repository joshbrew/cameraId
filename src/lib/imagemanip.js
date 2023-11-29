import {threadop} from './threadop.esm.js'

export function mapBitmapXIntensities(ImageDataUint8, width, height) {
    const data = new Uint32Array(ImageDataUint8.buffer);

    const i = new Float32Array(width);
    const r = new Float32Array(width);
    const g = new Float32Array(width);
    const b = new Float32Array(width);

    let maxR = 0, maxG = 0, maxB = 0;

    
    for (let index = 0; index < data.length; index++) {
        const x = index % width;
        const rgba = data[index];

        const red = rgba & 0xFF;
        const green = (rgba >> 8) & 0xFF;
        const blue = (rgba >> 16) & 0xFF;

        i[x] += red + green + blue;
        r[x] += red;
        g[x] += green;
        b[x] += blue;

        // Update maxima for each color channel
        maxR = r[x] > maxR ? r[x] : maxR;
        maxG = g[x] > maxG ? g[x] : maxG;
        maxB = b[x] > maxB ? b[x] : maxB;
    }

    const intensities = new Array(width);
    let max = maxR + maxG + maxB;

    for (let x = 0; x < width; x++) {
        intensities[x] = {
            i: i[x] / max, // Normalize based on the maximum possible intensity
            r: r[x] / max,
            g: g[x] / max,
            b: b[x] / max
        };
    }

    return {
        intensities,
        width,
        height,
        maxR, maxG, maxB, maxI: maxR+maxG+maxB
    };
}

export function graphXIntensities(context, xrgbintensities, width, height, x0 = 0, y0 = 0) {
    context.lineWidth = 2;

    // Function to draw a line for a given color channel
    const drawLine = (channelData, strokeStyle) => {
        context.beginPath();
        context.strokeStyle = strokeStyle;

        channelData.forEach((value, i) => {
            const x = x0 + i * (width / channelData.length);
            const y = y0 + height * (1 - value);
            i === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
        });

        context.stroke();
    };

    // Draw lines for each channel
    drawLine(xrgbintensities.map(y => y.i), 'ghostwhite'); // Intensity
    drawLine(xrgbintensities.map(y => y.r), 'tomato');     // Red
    drawLine(xrgbintensities.map(y => y.g), 'chartreuse');  // Green
    drawLine(xrgbintensities.map(y => y.b), '#00b8f5');     // Blue

    return { xrgbintensities, width, height };
}

export function convertRGBAtoRGBFloat32(rgbaData) {

    // Ensure the length of the input array is a multiple of 4 (RGBA values)
    if (rgbaData.length % 4 !== 0) {
      throw new Error('Input array length must be a multiple of 4');
    }
  
    // Create a Float32Array to store the RGB values
    const numPixels = rgbaData.length / 4;
    const rgbData = new Float32Array(numPixels * 3);
  
    // Loop through the RGBA data and convert to RGB Float32 format
    for (let i = 0; i < numPixels; i++) {
      const rgbaIndex = i * 4;
      const rgbIndex = i * 3;
  
      // Convert each channel from Uint8 (0-255) to Float32 (0-1)
      rgbData[rgbIndex] = rgbaData[rgbaIndex] / 255;
      rgbData[rgbIndex + 1] = rgbaData[rgbaIndex + 1] / 255;
      rgbData[rgbIndex + 2] = rgbaData[rgbaIndex + 2] / 255;
    }
  
    return rgbData;
}



//B
export function convertRGBAToRGBPlanar(rgbaData, outputWidth, outputHeight) {
        // Initialize the number of pixels and the output array
        const numPixels = outputWidth * outputHeight;
        const rgbData = new Float32Array(numPixels * 3);
    
        // Define the means and standard deviations for each channel
        let mean0 = 0.485, std0 = 0.229;
        let mean1 = 0.456, std1 = 0.224;
        let mean2 = 0.406, std2 = 0.225;
        
        // Create a view of the RGBA data as 32-bit unsigned integers
        const uint32View = new Uint32Array(rgbaData.buffer);
    
        // Initialize indices for the R, G, and B channels in the output array
        let idxR = 0, idxG = numPixels, idxB = 2 * numPixels;
    
        // Loop over each pixel to convert and normalize the RGB values
        for (let i = 0; i < numPixels; i++) {
            // Extract the RGBA values using bitwise operations
            const rgba = uint32View[i];
            const r = (rgba & 0xFF) / 255.0;
            const g = ((rgba >> 8) & 0xFF) / 255.0;
            const b = ((rgba >> 16) & 0xFF) / 255.0;
    
            // Apply the normalization (value - mean) / std for each channel
            rgbData[idxR++] = (r - mean0) / std0;
            rgbData[idxG++] = (g - mean1) / std1;
            rgbData[idxB++] = (b - mean2) / std2;
        }
    
        // Return the normalized RGB planar data
        return rgbData;
}

export async function autocorrelateImage(ImageDataUint8, imageWidth, imageHeight) {
    const reconstructed = new Uint8Array(imageWidth * imageHeight * 4);

    const autocorrelatePixel = () => {
        const resultR = new Array(imageWidth * imageHeight).fill(0);
        const resultG = new Array(imageWidth * imageHeight).fill(0);
        const resultB = new Array(imageWidth * imageHeight).fill(0);

        for (let y = 0; y < imageHeight; y++) {
            for (let x = 0; x < imageWidth; x++) {
                let R = 0, G = 0, B = 0;
                const idx = (y * imageWidth + x) * 4;

                for (let b = 0; b < imageHeight; b++) {
                    for (let a = 0; a < imageWidth; a++) {
                        const otherIdx = (b * imageWidth + a) * 4;
                        R += ImageDataUint8[idx] * ImageDataUint8[otherIdx];
                        G += ImageDataUint8[idx] * ImageDataUint8[otherIdx+1];
                        B += ImageDataUint8[idx] * ImageDataUint8[otherIdx+2];
                    }
                }

                const resultIdx = y * imageWidth + x;
                resultR[resultIdx] = R;
                resultR[resultIdx] = G;
                resultR[resultIdx] = B;
            }
        }

        return {r:resultR,g:resultG,b:resultB};
    };

    const {r,g,b} = autocorrelatePixel();

    for (let y = 0; y < imageHeight; y++) {
        for (let x = 0; x < imageWidth; x++) {
            const idx = (y * imageWidth + x) * 4;
            const resultIdx = y * imageWidth + x;

            reconstructed[idx] = r[resultIdx];
            reconstructed[idx + 1] = g[resultIdx];
            reconstructed[idx + 2] = b[resultIdx];
            reconstructed[idx + 3] = 255; // Alpha channel
        }
    }


    return new Uint8ClampedArray(reconstructed);
}

let autocorrelateImageThreadedPool;

export async function autocorrelateImageThreaded(ImageDataUint8, imageWidth, imageHeight) {
    // Split the image data into separate color channels
    const redChannel = new Uint8Array(imageWidth * imageHeight);
    const greenChannel = new Uint8Array(imageWidth * imageHeight);
    const blueChannel = new Uint8Array(imageWidth * imageHeight);

    for (let i = 0, j = 0; i < ImageDataUint8.length; i += 4, j++) {
        redChannel[j] = ImageDataUint8[i];
        greenChannel[j] = ImageDataUint8[i + 1];
        blueChannel[j] = ImageDataUint8[i + 2];
        // Alpha channel is ignored
    }

    const autocorrelateSegment = ({ channelData, imageWidth, imageHeight }) => {
        const result = new Uint8Array(imageWidth * imageHeight);
    
        for (let y = 0; y < imageHeight; y++) {
            for (let x = 0; x < imageWidth; x++) {
                let G = 0;
                const idx = y * imageWidth + x;
    
                for (let b = 0; b < imageHeight; b++) {
                    for (let a = 0; a < imageWidth; a++) {
                        const otherIdx = b * imageWidth + a;
                        G += channelData[idx] * channelData[otherIdx];
                    }
                }
    
                result[idx] = G;
            }
        }
    
        console.log('running autocor');
        return result;
    };

    if(!autocorrelateImageThreadedPool) autocorrelateImageThreadedPool = await threadop(autocorrelateSegment,{pool:3}); 
    let runs = [
        autocorrelateImageThreadedPool.run({channelData:redChannel, imageWidth, imageHeight}, [redChannel.buffer]),
        autocorrelateImageThreadedPool.run({channelData:greenChannel, imageWidth, imageHeight}, [greenChannel.buffer]),
        autocorrelateImageThreadedPool.run({channelData:blueChannel, imageWidth, imageHeight}, [blueChannel.buffer])
    ];
    //could set a timer that kills the threadpool if not run after a duration

    // Run autocorrelation for each color channel
    const [
        redResult,
        greenResult,
        blueResult
    ] = await Promise.all(runs);

    // Recombine the results
    const reconstructed = new Uint8Array(imageWidth * imageHeight * 4);

    for (let i = 0, j = 0; i < redResult.length; i++, j += 4) {
        reconstructed[j] = redResult[i];
        reconstructed[j + 1] = greenResult[i];
        reconstructed[j + 2] = blueResult[i];
        reconstructed[j + 3] = 255; // Alpha channel
    }

    return new Uint8ClampedArray(reconstructed);
}
