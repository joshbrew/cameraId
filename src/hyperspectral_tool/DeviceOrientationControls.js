import * as THREE from 'three'
/**
 * @author richt / http://richt.me  
 * @author WestLangley / http://github.com/WestLangley
 * @author JoshBrewster / https://github.com/joshbrew (updated)
 * W3C Device Orientation control (http://w3c.github.io/deviceorientation/spec-source-orientation.html)
 */


const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // - PI/2 around the x-axis


export class DeviceOrientationControls {
    object = null;
    enabled = true;
    deviceOrientation = {};
    screenOrientation = typeof screen !== 'undefined' ? screen.orientation.angle || 0 : 0;
    portraitMode = typeof screen !== 'undefined' ? screen.orientation.type || 'landscape-primary' : 'landscape-primary';
    alpha = 0;
    beta = 0;
    gamma = 0;
    initialQuaternion = new THREE.Quaternion();
    firstCall = true;
    offsetDeg = 0; // Assuming default value, adjust as necessary
    firstEvent = null; // Assuming default value, adjust as necessary
    onEvent = null; // Assuming default value, adjust as necessary
    canvas = null; // Assuming default value, adjust as necessary
    initialQuaternion = new THREE.Quaternion();

    constructor(object, offsetDeg, firstEvent, onEvent, canvas) {
        this.object = object;
        this.object.rotation.reorder("YXZ");
        this.offsetDeg = offsetDeg;
        this.firstEvent = firstEvent;
        this.onEvent = onEvent;
        this.canvas = canvas;

        // Set the initial quaternion based on the object's current rotation
        this.initialQuaternion.copy(this.object.quaternion);

        // Auto-connect on instantiation
        this.connect();
    }

	reset() {
		
	}

    onDeviceOrientationChangeEvent = (event) => {
        this.deviceOrientation = event;
    };

    onScreenOrientationChangeEvent = (ev) => {
        this.screenOrientation = ev.target.angle;
        this.portraitMode = ev.target.type;
    };

    setObjectQuaternion = (quaternion, alpha, beta, gamma, orient) => {
		euler.set(beta, alpha, -gamma, 'YXZ');
		quaternion.setFromEuler(euler);
		quaternion.multiply(q1);
		quaternion.multiply(q0.setFromAxisAngle(zee, -orient));
		quaternion.premultiply(this.initialQuaternion); // Apply the initial orientation
	};

    update = () => {
        if (!this.enabled) return;

        const { alpha, beta, gamma } = this.deviceOrientation;
        if (typeof alpha === 'number') {
            const orient = THREE.MathUtils.degToRad(this.screenOrientation || 0);
            const radAlpha = THREE.MathUtils.degToRad(alpha || 0);
            const radBeta = THREE.MathUtils.degToRad(beta || 0);
            const radGamma = THREE.MathUtils.degToRad(gamma || 0);

            if (radAlpha === this.alpha && radBeta === this.beta && radGamma === this.gamma) return;

            this.alpha = radAlpha;
            this.beta = radBeta;
            this.gamma = radGamma;

            this.setObjectQuaternion(this.object.quaternion, radAlpha, radBeta, radGamma, orient);

            if (this.firstCall && this.firstEvent) {
                this.firstCall = false;
                this.firstEvent(this.object, this.deviceOrientation, this.screenOrientation, this.portraitMode);
            }

            if (this.onEvent) {
                this.onEvent(this.object, this.deviceOrientation, this.screenOrientation, this.portraitMode);
            }
        }
    };

    connect = () => {
        if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
            this.canvas.addEventListener('orientation', this.onScreenOrientationChangeEvent, false);
            this.canvas.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent, false);
        } else {
            screen?.orientation.addEventListener('change', this.onScreenOrientationChangeEvent, false);
            window.addEventListener('deviceorientation', this.onDeviceOrientationChangeEvent, false);
        }
        this.enabled = true;
    };

    disconnect = () => {
        if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
            this.canvas.removeEventListener('orientation', this.onScreenOrientationChangeEvent, false);
            this.canvas.removeEventListener('deviceorientation', this.onDeviceOrientationChangeEvent, false);
        } else {
            screen?.orientation.removeEventListener('change', this.onScreenOrientationChangeEvent, false);
            window.removeEventListener('deviceorientation', this.onDeviceOrientationChangeEvent, false);
        }
        this.enabled = false;
    };

    dispose = () => {
        this.disconnect();
    };
}