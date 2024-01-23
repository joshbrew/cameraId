//@ts-ignore
import html from './imageprocessor.html'

import './imageprocessor.css' //compiled into main css by esbuild

export class ImageProcessorComponent extends HTMLElement {
    modelInpWidth = 224;
    modelInpHeight = 224;
    selectedClassifier = 'defaultclassifier';
    threadSettings = {} as any;

    constructor() {
        super();
        // Load and set the HTML template
        const shadow = this.attachShadow({ mode: 'open' });
        shadow.innerHTML = html;
        // After setting innerHTML, update the template based on properties
        this.updateTemplate(shadow);

        const classNames = [
            'button',
            'input::file-selector-button',
            'video',
            'capture-btn',
            'image',
            'fadeIn'
        ];
        
        this.transferGlobalStyles(classNames);
    }


    updateTemplate(shadow=this.shadowRoot as ShadowRoot) {

        // Update classifier radio buttons
        const classifiers = ['spectralclassifier', 'imageclassifier', 'defaultclassifier','customclassifier'];
        classifiers.forEach(classifier => {
            const radioBtn = shadow.querySelector(`#${classifier}`) as HTMLInputElement;
            if (radioBtn) {
                radioBtn.checked = this.selectedClassifier === classifier;
            }
            if(classifier === 'customclassifier' && !radioBtn.checked)  {
                (shadow.querySelector('#customtable') as HTMLElement).style.display = 'none';
            }
        });

        // Update model input width and height
        const widthInput = shadow.querySelector('#width') as HTMLInputElement;
        if (widthInput) {
            widthInput.value = this.modelInpWidth as any;
        }

        const heightInput = shadow.querySelector('#height') as HTMLInputElement;
        if (heightInput) {
            heightInput.value = this.modelInpHeight as any;
        }

        // Update thread settings
        Object.keys(this.threadSettings).forEach(key => {
            const input = shadow.querySelector(`#${key}`) as HTMLInputElement;
            if (input) {
                input.value = this.threadSettings[key];
            }
        });

        // Further updates can be added here as needed
    }

    //this is a hack to aggregate global styles into a shadowroot because we have to mess with our compiler otherwise to keep things in their own file types
    transferGlobalStyles(classNames) {
        const styleElement = document.createElement('style');
        let aggregatedStyles = '';

        classNames.forEach(className => {
            const rules = this.extractGlobalStyles(className);
            aggregatedStyles += rules.join(' ') + ' ';
        });

        styleElement.textContent = aggregatedStyles;
        (this.shadowRoot as ShadowRoot).prepend(styleElement);
    }

    extractGlobalStyles(className) {
        const hasClass = new RegExp(`${className}(?:[^\\w-]|$|-)`);
        const rules = [] as any[];

        const processRules = (cssRules, foundrules={}) => {
            Array.prototype.forEach.call(cssRules, rule => {
                if (rule instanceof CSSStyleRule && hasClass.test(rule.selectorText)) {
                    rules.push(rule.cssText);
                } else if (rule.name?.includes(className)) {
                    rules.push(rule.cssText);
                } 
            });
        };

        Array.prototype.forEach.call(document.styleSheets, sheet => {
            if (sheet.cssRules) {
                processRules(sheet.cssRules);
            }
        });

        return rules;
    }

}

customElements.define('image-processor', ImageProcessorComponent);