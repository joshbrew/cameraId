import * as THREE from 'three'

const freq = 60;

const useGyro = false;
const useOrientation = true;
const usePiSocket = true;

let rotationRate = {
initialX:0,
initialY:0,
initialZ:0,
x:0,
y:0,
z:0,
rotX:0,
rotY:0,
rotZ:0,
ticks:0
}

if(useGyro) {
let gyro = new Gyroscope({frequency:freq}); //we could do accel + gyro if we wanted to get weird.
//use one or the other option
gyro.addEventListener("reading", () => {
    rotationRate.x += gyroscope.x; //rad/s
    rotationRate.y += gyroscope.y;
    rotationRate.z += gyroscope.z;
    rotationRate.ticks++;
});

gyro.start();
} else if (useOrientation) { //probably safest option for mobile
window.addEventListener('deviceorientation',(ev)=>{ 
    if(!rotationRate.initialX) {
        rotationRate.initialX = ev.alpha * Math.PI / 180;
        rotationRate.initialY = ev.beta * Math.PI / 180;
        rotationRate.initialZ = ev.gamma * Math.PI / 180;
    }
    rotationRate.rotX = ev.alpha * Math.PI / 180;
    rotationRate.rotY = ev.beta * Math.PI / 180;
    rotationRate.rotZ = ev.gamma * Math.PI / 180;
    rotationRate.ticks++;
});
} else if (usePiSocket) { //a raspberry pi reporting over a websocket unless we can figure out what browser needs to recognize
let ws = new WebSocket('http://127.0.0.1:8181');
ws.addEventListener('message',(ev)=>{
    //let's just print a dict from the RPi
    if(ev.data.length < 5) return;
    const parsed = JSON.parse(ev.data);
    rotationRate.x += parsed.x; //rad/s
    rotationRate.y += parsed.y;
    rotationRate.z += parsed.z;
    rotationRate.ticks++;

});
}









// Scene Setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 0;
camera.rotation.y = Math.PI;
const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true }); // Add preserveDrawingBuffer
renderer.autoClear = false;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.clear();
document.body.appendChild(renderer.domElement);

document.getElementById('clear').onclick = () => { renderer.clear() }



// Video Texture Setup
const video = document.createElement('video');
video.src = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4'; // Online video URL
video.crossOrigin = "anonymous"; // Handle CORS
video.load();
let played = false;
document.body.onclick = () => {
if(!played) {
    played = true;
    video.play();
}
}
video.muted = true;
video.loop = true;


const videoTexture = new THREE.VideoTexture(video);

// Material with Video Texture
const videoMaterial = new THREE.MeshBasicMaterial({ map: videoTexture });
// Assuming width and height are dimensions of the FOV
const fovDegree = 20;
const fovRadians = THREE.MathUtils.degToRad(fovDegree);

// SphereGeometry parameters

// Calculate the segment size based on the FOV
const phiLength = fovRadians; // 20 degrees in radians for longitude
const thetaLength = fovRadians; // 20 degrees in radians for latitude

// Constants for 16:9 aspect ratio FOV in radians
const horizontalFOVDegrees = 20; // For example, a 20-degree horizontal FOV
const verticalFOVDegrees = (horizontalFOVDegrees / 16) * 9; // Calculate the vertical FOV based on a 16:9 aspect ratio

const horizontalFOVRadians = THREE.MathUtils.degToRad(horizontalFOVDegrees);
const verticalFOVRadians = THREE.MathUtils.degToRad(verticalFOVDegrees);

// SphereGeometry parameters for the partial sphere
const radius = 5; // Keep the radius the same for both spheres
const widthSegments = 50; // Number of horizontal segments
const heightSegments = 50; // Number of vertical segments

// Create the partial sphere geometry with the 16:9 aspect FOV
const partialSphereGeometry = new THREE.SphereGeometry(
radius, widthSegments, heightSegments,
Math.PI / 2 - horizontalFOVRadians / 2, horizontalFOVRadians, // phiStart and phiLength
Math.PI / 2 - verticalFOVRadians / 2, verticalFOVRadians // thetaStart and thetaLength
);

// Create the mesh with the partial sphere geometry
const partialSphere = new THREE.Mesh(partialSphereGeometry, videoMaterial);

scene.add(partialSphere);
partialSphere.material.side = THREE.DoubleSide;

// Complete Sphere
// const completeSphereGeometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
// const completeSphereMaterial = new THREE.MeshBasicMaterial({ 
//     color: 0xcccccc,
//     transparent: true,
//     opacity: 0.1
// });

// const completeSphere = new THREE.Mesh(completeSphereGeometry, completeSphereMaterial);
// scene.add(completeSphere);
// completeSphere.material.side = THREE.DoubleSide;
// // Set the same center for rotation for both spheres
// partialSphere.position.set(0, 0, 0);
// completeSphere.position.set(0, 0, 0);

// // Create an offscreen canvas
// const offscreenCanvas = document.createElement('canvas');
// offscreenCanvas.width = window.innerWidth;
// offscreenCanvas.height = window.innerHeight;
// const offscreenContext = offscreenCanvas.getContext('2d');

// Render Target for capturing partial sphere texture
const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);

// Function to Render Partial Sphere to Texture
function renderPartialSphereToTexture() {
// Render the partial sphere to the render target
renderer.setRenderTarget(renderTarget);
// If you want to clear the render target every time you can do it manually here
// renderer.clear();
renderer.render(scene, camera);
renderer.setRenderTarget(null); // Reset to default render target


// // Update the complete sphere's material with the rendered texture
// completeSphere.material.map = renderTarget.texture;
// completeSphere.material.needsUpdate = true; // Important to update the material
}

// Use the offscreen canvas as the texture for the complete sphere
// const completeSphereTexture = new THREE.CanvasTexture(offscreenCanvas);
// completeSphere.material.map = completeSphereTexture;

// Sliders for Partial Sphere Rotation
const xSlider = document.getElementById('xSlider');
const ySlider = document.getElementById('ySlider');
const zSlider = document.getElementById('zSlider');

xSlider.oninput = () => {
partialSphere.rotation.x = parseFloat(xSlider.value);
}
ySlider.oninput = () => {
partialSphere.rotation.y = parseFloat(ySlider.value);
}
zSlider.oninput = () => {
partialSphere.rotation.z = parseFloat(zSlider.value);
}
// Update Partial Sphere Rotation based on Sliders
function updatePartialSphereRotation() {
if((useGyro || useOrientation)) {
    if(rotationRate.ticks > 0) {
        partialSphere.rotation.x = rotationRate.rotX - rotationRate.initialX;
        partialSphere.rotation.y = rotationRate.rotY - rotationRate.initialY;
        partialSphere.rotation.z = rotationRate.rotZ - rotationRate.initialZ;

        if(useGyro) {
            partialSphere.rotation.x += rotationRate.ticks * rotationRate.x / freq; //freq samples per second, so 
            partialSphere.rotation.y += rotationRate.ticks * rotationRate.y / freq;
            partialSphere.rotation.z += rotationRate.ticks * rotationRate.z / freq; 

            rotationRate.x = 0; 
            rotationRate.y = 0; 
            rotationRate.z = 0; 
        }

        rotationRate.ticks = 0;
    }
}
}

// Animation Loop
function animate() {
requestAnimationFrame(animate);

// Update partial sphere rotation
updatePartialSphereRotation();

// Render the partial sphere to the texture
renderPartialSphereToTexture();

// Only clear the depth buffer to allow painting over the scene
renderer.clearDepth(); 
renderer.render(scene, camera);
}

animate(); // Start the animation loop