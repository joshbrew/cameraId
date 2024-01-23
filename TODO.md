
## TODO:

!! Fix mobile build dependencies so webworkers and onnx are functional


- Image baseline averaging is a little jank, make sure you compare the same number of averaged images to get good subtraction in the raw image (the CSV is fine). Basically the canvas averaging method also lowers the final opacity so you need to use the same number of averaged images in the baseline and subtracted sample but this is a coding issue.


- Can we implement bounding box or scene segmentation automation?
- hot reloading the css does not trigger in web components the way it's currently set up just fyi. Not 100% sure why.
- Wavelength estimation https://www.mdpi.com/1424-8220/23/9/4291

- RPi Web Server demo
- Capacitor mobile integration
- Google cloud/firebase/bigquery or something for direct image/video uploading to our database, sort by users 
    - login system? I think we'll just use GDrive for now with their ez oauth system
- Look into UVC camera support (what the Arducams are) using node or python on a local server packaged into the app, e.g. https://github.com/joelpurra/node-uvc to get control over camera gain/exposure etc.


- For hyperspectral, swap to the capacitor accelerometer API.
- multicolor hyperspectral images in single pass
- download the images