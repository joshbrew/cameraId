export class ModalButton extends HTMLElement {
    constructor() {
        super();
        this.shadow = this.attachShadow({mode: 'open'});

        // Button that opens the modal
        const button = document.createElement('button');
        button.setAttribute('class', 'modal-button');
        button.innerHTML = '<slot name="modal-button">Open Modal</slot>';

        // Modal dialog
        const modal = document.createElement('dialog');
        modal.setAttribute('class', 'modal-dialog');
        modal.innerHTML = `
            <slot name="modal-header"></slot>    
            <slot name="modal-content"></slot>
            <slot name="modal-footer">
                <button id="close" class="modal-close-button">Close</button>
            </slot>
        `;

        // Append elements to the shadow DOM
        this.shadow.appendChild(button);
        this.shadow.appendChild(modal);


        // Default styles
        this.defaultStyles = `
            .modal-button {
                /* Default button styles */
            }
            .modal-dialog {
                /* Default dialog styles */
            }
            .modal-close-button {
                /* Default close button styles */
            }
        `;
    }

    connectedCallback() {
    
        const button = this.shadow.querySelector('button');
        const modal = this.shadow.querySelector('dialog');
        // Event listeners
        button.addEventListener('click', () => {
            modal.showModal();
            this.dispatchEvent(new CustomEvent('open'));
        });

        modal.querySelector('#close').addEventListener('click', () => {
            modal.close();
            this.dispatchEvent(new CustomEvent('close'));
        });

        // Define your component's class names
        const classNames = ['modal-button', 'modal-dialog', 'modal-close-button', 'fade-in', 'fade-out'];

        // Iterate through each class and apply styles
        this._styles = ``;

        let foundrules = {};

        classNames.forEach(className => {
            const rules = this.getStylesForClass(className, foundrules);
            this._styles += (rules.join(' ')) + ' ';
        });

        // Apply default styles or custom styles if they exist
        this.updateStyles();
    }

    getStylesForClass(className) {
        const hasClass = new RegExp(`\\.${className}(?:[^\\w-]|$)`);
        const rules = [];


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

    updateStyles() {
        let styleElement = this.shadow.querySelector('style');
        if (!styleElement) {
            styleElement = document.createElement('style');
            this.shadow.prepend(styleElement);
        }
        styleElement.textContent = this.styles || this.defaultStyles;
    }

    get styles() {
        return this._styles;
    }

    set styles(val) {
        this._styles = val;
        this.updateStyles();
    }
}


customElements.define('modal-button', ModalButton);
