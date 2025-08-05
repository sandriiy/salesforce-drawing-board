import { LightningElement } from 'lwc';
import { loadScript } from 'lightning/platformResourceLoader';
import cometdLib from '@salesforce/resourceUrl/CometDLib';
import pakoLib from '@salesforce/resourceUrl/PakoLib';
import getSessionDetails from '@salesforce/apex/RealTimeController.getSessionDetails';
import getInitialCanvasState from '@salesforce/apex/RealTimeController.getInitialCanvasState';
import publishRealTimeDrawEvent from '@salesforce/apex/RealTimeController.publishRealTimeDrawEvent';

const INSTANCE_URL = 'https://inddev2-dev-ed.my.site.com/cometd/64.0';

export default class RealTimeDraw extends LightningElement {
    cometd;
    localSessionId;
    sessionId;
    instanceUrl = INSTANCE_URL;
    canvas;
    context;
    drawing = false;
    currentStroke = [];
    strokes = [];
    pakoLoaded = false;
    cometdLoaded = false;

    async connectedCallback() {
        await this.generateOrRetrieveSfSessionId();
        this.localSessionId = this.generateOrRetrieveLocalSessionId();

        Promise.all([
            loadScript(this, cometdLib + '/cometd/cometd.js'),
            loadScript(this, pakoLib),
            getInitialCanvasState()
        ])
        .then(([_, __, initialState]) => {
            this.pakoLoaded = true;
            this.cometdLoaded = true;

            this.initializeCometd();
            this.initializeCanvas();
            this.loadCanvasData(initialState);
        })
        .catch(error => {
            console.error('Third-party libraries did not load. Bad for you, try reloading the page.');
            console.log(error);
        });
    }

    renderedCallback() {
        if (!this.canvas) {
            this.canvas = this.template.querySelector('canvas');
            this.context = this.canvas.getContext('2d');
            this.resizeCanvas();
            window.addEventListener('resize', this.resizeCanvas.bind(this));
        }
    }

    initializeCanvas() {
        this.canvas.addEventListener('mousedown', e => {
            this.startDrawing(e.offsetX, e.offsetY);
        });

        this.canvas.addEventListener('mousemove', e => {
            this.continueDrawing(e.offsetX, e.offsetY);
        });

        window.addEventListener('mouseup', () => {
            this.stopDrawing();
        });

        this.canvas.addEventListener('touchstart', e => {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            this.startDrawing(x, y);
        }, { passive: false });

        this.canvas.addEventListener('touchmove', e => {
            const touch = e.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;
            this.continueDrawing(x, y);
            e.preventDefault(); // prevent scrolling while drawing
        }, { passive: false });

        window.addEventListener('touchend', () => {
            this.stopDrawing();
        });
    }

    startDrawing(x, y) {
        this.drawing = true;
        this.currentStroke = [{ x, y }];
        this.context.beginPath();
        this.context.moveTo(x, y);
    }

    continueDrawing(x, y) {
        if (!this.drawing) return;
        this.currentStroke.push({ x, y });
        this.context.lineTo(x, y);
        this.context.stroke();
    }

    stopDrawing() {
        if (this.drawing) {
            this.drawing = false;
            const optimized = this.optimizeStroke(this.currentStroke);
            this.strokes.push(optimized);
            this.publishDrawingEvent(optimized);
        }
    }

    resizeCanvas() {
        const container = this.template.querySelector('.canvas-container');
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.redrawStrokes();
    }

    redrawStrokes() {
        if (!this.context) return;
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.beginPath();
        this.strokes.forEach(stroke => {
            if (stroke.length > 0) {
                this.context.moveTo(stroke[0].x, stroke[0].y);
                stroke.forEach(pt => this.context.lineTo(pt.x, pt.y));
            }
        });
        this.context.stroke();
    }

    optimizeStroke(stroke) {
        return stroke.map(p => ({x: +p.x.toFixed(1),y: +p.y.toFixed(1)}));
    }

    compressData(jsonData) {
        const compressed = window.pako.deflate(jsonData);
        return btoa(String.fromCharCode.apply(null, compressed));
    }

    decompressData(base64Data) {
        const strData = atob(base64Data);
        const binData = new Uint8Array(strData.length);
        for (let i = 0; i < strData.length; i++) binData[i] = strData.charCodeAt(i);
        return window.pako.inflate(binData, { to: 'string' });
    }

    loadCanvasData(compressedData) {
        try {
            const jsonData = this.decompressData(compressedData);
            const newStrokes = JSON.parse(jsonData);
            this.strokes = [...this.strokes, ...newStrokes];
            this.redrawStrokes();
        } catch (error) {
            console.error('Load canvas error:', error);
        }
    }

    initializeCometd() {
        this.cometd = new window.org.cometd.CometD();
        this.cometd.websocketEnabled = false;
        this.cometd.configure({
            url: this.instanceUrl,
            requestHeaders: { Authorization: 'OAuth ' + this.sessionId },
            appendMessageTypeToURL: false
        });

        this.cometd.handshake(handshake => {
            if (handshake.successful) {
                this.cometd.subscribe('/event/RealTimeDraw__e', ({ data: { payload } }) => {
                    if (payload.LocalSessionId__c != this.localSessionId) {
                        this.loadCanvasData(payload.State__c);
                    }
                });
            } else {
                console.error('Handshake failed:', handshake);
                this.clearSfSessionAndRefresh();
            }
        });
    }

    publishDrawingEvent(stroke) {
        const compressedStroke = this.compressData(JSON.stringify([stroke]));
        publishRealTimeDrawEvent({ compressedState: compressedStroke, localSessionId: this.localSessionId })
            .then(() => {
                console.log('Event published successfully');
            })
            .catch(error => {
                console.error('Error publishing event:', error);
            });
    }

    generateOrRetrieveLocalSessionId() {
        const SESSION_KEY = 'realTimeCanvasSessionId';
        let sessionId = localStorage.getItem(SESSION_KEY);

        if (!sessionId) {
            sessionId = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem(SESSION_KEY, sessionId);
        }

        return sessionId;
    }

    async generateOrRetrieveSfSessionId() {
        const SESSION_KEY = 'realTimeCanvasSfSessionId';
        const cachedSession = sessionStorage.getItem(SESSION_KEY);

        if (cachedSession) {
            this.sessionId = cachedSession;
        } else {
            try {
                const result = await getSessionDetails();
                this.sessionId = result;
                sessionStorage.setItem(SESSION_KEY, this.sessionId);
            } catch (error) {
                console.error('Error retrieving session details');
            }
        }
    }

    clearSfSessionAndRefresh() {
        sessionStorage.removeItem('realTimeCanvasSfSessionId');
        window.location.reload();
    }
}