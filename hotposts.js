import { supabase } from './supabase.js';
import { showToast } from './ui.js';
import { timeAgo } from './utils.js';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_HOTPOSTS_PRESET } from './config.js';

// ==========================================
// STATE MANAGEMENT & FONT ENGINE
// ==========================================
let hotpostsByUser = new Map();
let currentUser = null;
let sessionViewedPostIds = new Set();
let isUploadingBackground = false; 

const HOTPOST_SKELETON = `
    <div class="flex flex-col items-center gap-1.5 shrink-0">
        <div class="w-[80px] h-[80px] rounded-full shimmer-bg shadow-sm"></div>
        <div class="w-12 h-2.5 rounded-full shimmer-bg mt-1"></div>
    </div>
`.repeat(6);

const ACTIVITY_SKELETON = `
    <div class="flex items-center gap-3 p-3 animate-pulse">
        <div class="w-10 h-10 rounded-full shimmer-bg shrink-0"></div>
        <div class="flex-1 space-y-2">
            <div class="h-3.5 shimmer-bg rounded-md w-1/2"></div>
            <div class="h-2.5 shimmer-bg rounded-md w-1/3"></div>
        </div>
    </div>
`.repeat(5);

// 🚀 NATIVE ZERO-LOAD FONT STACKS (Matches Instagram Styles)
const TEXT_FONTS = [
    { name: 'Classic', value: 'Georgia, serif' },
    { name: 'Modern', value: 'system-ui, -apple-system, sans-serif' },
    { name: 'Neon', value: '"Arial Rounded MT Bold", Arial, sans-serif' },
    { name: 'Typewriter', value: '"Courier New", Courier, monospace' },
    { name: 'Strong', value: 'Impact, Charcoal, sans-serif' },
    { name: 'Elegant', value: '"Palatino Linotype", "Book Antiqua", Palatino, serif' },
    { name: 'Headline', value: '"Arial Black", Gadget, sans-serif' },
    { name: 'Simple', value: 'Arial, Helvetica, sans-serif' },
    { name: 'Editor', value: '"Lucida Console", Monaco, monospace' },
    { name: 'Fancy', value: '"Brush Script MT", "Lucida Handwriting", cursive' },
    { name: 'Comic', value: '"Comic Sans MS", "Comic Sans", cursive' },
    { name: 'Memo', value: '"Trebuchet MS", "Lucida Grande", sans-serif' }
];

const TEXT_COLORS = ['#FFFFFF', '#000000', '#FF3B30', '#34C759', '#007AFF', '#FFD60A', '#FF9F0A', '#BF5AF2', '#32ADE6'];

let currentTextFont = TEXT_FONTS[0].value;
let currentTextColor = '#FFFFFF';
let currentTextBg = false;
let currentTextAlign = 'center'; // 🚀 Added Alignment State

// 🚀 Calculates perfect contrast (Black or White) for Text Backgrounds
function getContrastYIQ(hexcolor){
    hexcolor = hexcolor.replace("#", "");
    if (hexcolor.length === 3) hexcolor = hexcolor.split('').map(c => c+c).join('');
    var r = parseInt(hexcolor.substr(0,2),16);
    var g = parseInt(hexcolor.substr(2,2),16);
    var b = parseInt(hexcolor.substr(4,2),16);
    var yiq = ((r*299)+(g*587)+(b*114))/1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}

let currentCameraStream = null;
let currentFacingMode = 'environment';
let currentPhotoBlob = null;
let baseImageObj = null; 

let videoZoomScale = 1;
let initialVideoPinchDist = 0;

let imgTransform = { scale: 1, x: 0, y: 0 }; 
let isDraggingBg = false;
let bgDragStartX = 0, bgDragStartY = 0;
let initialBgScale = 1;

const FILTER_LIST = [
    { name: 'NORMAL', css: 'none' },
    { name: 'VIVID', css: 'saturate(1.6) contrast(1.1)' },
    { name: 'WARM', css: 'sepia(0.4) saturate(1.2) contrast(1.1)' },
    { name: 'COOL', css: 'hue-rotate(180deg) saturate(1.2)' },
    { name: 'B&W', css: 'grayscale(1) contrast(1.2)' }
];
let currentFilterIndex = 0;

let textElements = [];
let activeTextId = null;
let activeTextIdForTouch = null;
let textTouchStartTime = 0;
let initialPinchDist = 0;
let initialTextScale = 1.0;
let textInitialObjX = 0, textInitialObjY = 0;

let isDrawMode = false;
let isDrawing = false;
let currentDoodleColor = '#FFFFFF'; 
let currentDoodleWidth = 6; 
let doodlePaths = []; 
let currentPath = [];

let currentViewerState = {
    userId: null, userOrder: [], userIndex: -1, postIndex: 0,
    storyTimer: null, storyDuration: 5000, animationStartTime: 0, remainingDuration: 0,
};

const CLOUDINARY_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

export function initHotposts(user) {
    currentUser = user;
    setupEventListeners();
    fetchHotposts();
}

function setupEventListeners() {
    document.getElementById('close-hotpost-camera-btn')?.addEventListener('click', attemptCloseCamera);
    document.getElementById('switch-hotpost-camera-btn')?.addEventListener('click', switchCamera);
    document.getElementById('capture-hotpost-btn')?.addEventListener('click', capturePhoto);
    document.getElementById('submit-hotpost-btn')?.addEventListener('click', submitHotpost);

// 🚀 FIX: Pass the active text ID so clicking "Aa" edits the selected text instead of opening an empty box
    document.getElementById('add-text-hotpost-btn')?.addEventListener('click', () => activateTextTool(activeTextId));    document.getElementById('doodle-hotpost-btn')?.addEventListener('click', toggleDrawMode);
    document.getElementById('undo-doodle-btn')?.addEventListener('click', undoLastDoodle);
    
    document.querySelectorAll('.doodle-color-btn').forEach(btn => {
        btn.addEventListener('click', (e) => setDoodleColor(e.target.dataset.color));
    });

    document.getElementById('cancel-text-btn')?.addEventListener('click', () => {
        document.getElementById('hotpost-text-editor-overlay').classList.replace('flex', 'hidden');
    });
    document.getElementById('done-text-btn')?.addEventListener('click', saveTextFromUI);
    
    document.getElementById('toggle-text-bg-btn')?.addEventListener('click', () => {
        currentTextBg = !currentTextBg;
        updateTextUIPreview();
    });

   // 🚀 NEW ALIGNMENT TOGGLE
    document.getElementById('toggle-text-align-btn')?.addEventListener('click', (e) => {
        const btn = e.currentTarget.querySelector('span');
        if (currentTextAlign === 'center') {
            currentTextAlign = 'left';
            btn.textContent = 'format_align_left';
        } else if (currentTextAlign === 'left') {
            currentTextAlign = 'right';
            btn.textContent = 'format_align_right';
        } else {
            currentTextAlign = 'center';
            btn.textContent = 'format_align_center';
        }
        updateTextUIPreview();
    });

   // 🚀 INJECT FONTS & COLORS (Fixed Target Bubbling)
    const colorPicker = document.getElementById('text-color-picker');
    if (colorPicker) {
        colorPicker.innerHTML = TEXT_COLORS.map(color => `
            <button class="w-8 h-8 rounded-full shrink-0 border-2 ${color === '#FFFFFF' ? 'border-gray-300' : 'border-transparent'} shadow-sm transition-transform active:scale-90 text-color-btn" data-color="${color}" style="background-color: ${color};"></button>
        `).join('');
        colorPicker.querySelectorAll('.text-color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                currentTextColor = e.currentTarget.dataset.color; // Forces target to the button
                updateTextUIPreview();
            });
        });
    }

    const fontPicker = document.getElementById('text-font-picker');
    if (fontPicker) {
        fontPicker.innerHTML = TEXT_FONTS.map((font, index) => `
            <button class="px-4 py-1.5 rounded-full shrink-0 bg-white/20 text-white font-bold text-sm transition-transform active:scale-90 text-font-btn" data-fontindex="${index}" style="font-family: ${font.value.replace(/"/g, "'")}">${font.name}</button>
        `).join('');
        fontPicker.querySelectorAll('.text-font-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.dataset.fontindex; // Forces target to the button
                currentTextFont = TEXT_FONTS[idx].value;
                updateTextUIPreview();
            });
        });
    }
    setupVideoZoomPhysics();
    setupEditorTouchPhysics();
    setupViewerTouchPhysics();

    document.getElementById('close-hotpost-viewer-btn')?.addEventListener('click', closeHotpostViewer);
    document.getElementById('hotpost-nav-next')?.addEventListener('click', nextStory);
    document.getElementById('hotpost-nav-prev')?.addEventListener('click', prevStory);
    document.getElementById('hotpost-reply-btn')?.addEventListener('click', handleReplyToHotpost);
    document.getElementById('hotpost-like-btn')?.addEventListener('click', handleLikeHotpost);

    const navNext = document.getElementById('hotpost-nav-next');
    const navPrev = document.getElementById('hotpost-nav-prev');
    const replyInput = document.getElementById('hotpost-reply-input');
    
    [navNext, navPrev].forEach(el => {
        if (el) {
            el.addEventListener('pointerdown', pauseStory);
            el.addEventListener('pointerup', resumeStory);
            el.addEventListener('pointerleave', resumeStory);
        }
    });
    
    replyInput?.addEventListener('focus', pauseStory);
    replyInput?.addEventListener('blur', resumeStory);

    document.getElementById('details-tab-viewers')?.addEventListener('click', () => switchDetailsTab('viewers'));
    document.getElementById('details-tab-likes')?.addEventListener('click', () => switchDetailsTab('likes'));
    document.getElementById('details-tab-replies')?.addEventListener('click', () => switchDetailsTab('replies'));
    document.getElementById('hotpost-activity-btn')?.addEventListener('click', openActivityPanel);
    document.getElementById('activity-backdrop-close')?.addEventListener('click', closeActivityPanel);
    
    document.getElementById('delete-hotpost-action-btn')?.addEventListener('click', () => {
        showCustomConfirm("Delete Hotpost?", "This will permanently remove this post from your story.", executeDeleteHotpost);
    });

    document.getElementById('hotpost-gallery-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                currentPhotoBlob = file;
                baseImageObj = new Image();
                baseImageObj.onload = () => {
                    document.getElementById('hotpost-preview-img').src = event.target.result;
                    showPreviewUI();
                    initDoodleCanvas();
                };
                baseImageObj.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('doodle-size-slider')?.addEventListener('input', (e) => {
        currentDoodleWidth = parseInt(e.target.value);
    });
}

function showCustomConfirm(title, message, onConfirm) {
    pauseStory();
    const modal = document.getElementById('modal-confirm-action');
    if(!modal) return;
    
    document.getElementById('confirm-action-title').textContent = title;
    document.getElementById('confirm-action-message').textContent = message;
    
    modal.classList.replace('hidden', 'flex');
    
    const confirmBtn = document.getElementById('confirm-action-yes');
    const cancelBtn = document.getElementById('confirm-action-no');
    
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newCancelBtn.addEventListener('click', () => {
        modal.classList.replace('flex', 'hidden');
        resumeStory();
    });
    
    newConfirmBtn.addEventListener('click', () => {
        modal.classList.replace('flex', 'hidden');
        onConfirm();
    });
}

function attemptCloseCamera() {
    if (currentPhotoBlob) {
        showCustomConfirm("Discard Hotpost?", "If you go back now, you will lose your edits.", () => {
            resetCameraUI();
            closeCameraModal(true); 
        });
    } else {
        closeCameraModal(true);
    }
}

// ==========================================
// CAMERA ENGINE
// ==========================================
async function openCameraModal() {
    const modal = document.getElementById('modal-hotpost-camera');
    const video = document.getElementById('hotpost-camera-feed');
    modal.classList.replace('hidden', 'flex');
    resetCameraUI();
    toggleCameraStatusBar(true);

    if (currentCameraStream) currentCameraStream.getTracks().forEach(track => track.stop());

    try {
        currentCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacingMode, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        video.srcObject = currentCameraStream;
        
        videoZoomScale = 1;
        video.style.transform = currentFacingMode === 'user' ? `scaleX(-1) scale(${videoZoomScale})` : `scale(${videoZoomScale})`;
    } catch (err) {
        showToast('Camera access denied.', 'error');
        closeCameraModal(true);
    }
}

function closeCameraModal(force = false) {
    const modal = document.getElementById('modal-hotpost-camera');
    if (currentCameraStream) currentCameraStream.getTracks().forEach(track => track.stop());
    modal.classList.replace('flex', 'hidden');
    toggleCameraStatusBar(false);
}

function switchCamera() {
    currentFacingMode = currentFacingMode === 'environment' ? 'user' : 'environment';
    openCameraModal();
}

function setupVideoZoomPhysics() {
    const video = document.getElementById('hotpost-camera-feed');
    
    const getPinchDistance = (touches) => {
        return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    };

    video.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2 && document.getElementById('preview-ui').classList.contains('hidden')) {
            initialVideoPinchDist = getPinchDistance(e.touches);
        }
    }, { passive: true });

    video.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && document.getElementById('preview-ui').classList.contains('hidden')) {
            if (e.cancelable) e.preventDefault();
            const currentDist = getPinchDistance(e.touches);
            const scaleChange = currentDist / initialVideoPinchDist;
            
            videoZoomScale = Math.max(1.0, Math.min(4.0, videoZoomScale * scaleChange));
            initialVideoPinchDist = currentDist; 

            video.style.transform = currentFacingMode === 'user' 
                ? `scaleX(-1) scale(${videoZoomScale})` 
                : `scale(${videoZoomScale})`;
        }
    }, { passive: false });
}

function capturePhoto() {
    const video = document.getElementById('hotpost-camera-feed');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');

    if (currentFacingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
        currentPhotoBlob = blob;
        baseImageObj = new Image();
        baseImageObj.onload = () => {
            document.getElementById('hotpost-preview-img').src = URL.createObjectURL(blob);
            imgTransform.scale = videoZoomScale;
            document.getElementById('hotpost-preview-img').style.transform = `translate(0px, 0px) scale(${imgTransform.scale})`;
            showPreviewUI();
            initDoodleCanvas();
        };
        baseImageObj.src = URL.createObjectURL(blob);
    }, 'image/jpeg', 0.9);
}

function resetCameraUI() {
    document.getElementById('hotpost-camera-feed').classList.remove('hidden');
    document.getElementById('hotpost-preview-container').classList.add('hidden');
    document.getElementById('capture-ui').classList.remove('hidden');
    document.getElementById('preview-ui').classList.add('hidden');
    document.getElementById('switch-hotpost-camera-btn').classList.remove('hidden');
    document.getElementById('editor-tools-container').classList.add('hidden');
    
    currentPhotoBlob = null;
    videoZoomScale = 1;
    const video = document.getElementById('hotpost-camera-feed');
    if(video) video.style.transform = currentFacingMode === 'user' ? `scaleX(-1) scale(1)` : `scale(1)`;

    imgTransform = { scale: 1, x: 0, y: 0 };
    const previewImg = document.getElementById('hotpost-preview-img');
    if(previewImg) {
        previewImg.style.transform = `translate(0px, 0px) scale(1)`;
        previewImg.style.filter = FILTER_LIST[0].css;
    }
    
    currentFilterIndex = 0;
    isDrawMode = false;
    doodlePaths = [];
    document.getElementById('doodle-color-picker')?.classList.add('hidden');
    document.getElementById('doodle-size-slider')?.classList.add('hidden');
    
    const doodleBtn = document.getElementById('doodle-hotpost-btn');
    if (doodleBtn) {
        doodleBtn.classList.remove('bg-white', 'text-black');
        doodleBtn.classList.add('bg-black/40', 'text-white');
    }
    
    document.querySelectorAll('.text-widget').forEach(el => el.remove());
    
    textElements = [];
    activeTextId = null;
    activeTextIdForTouch = null;
}

function showPreviewUI() {
    document.getElementById('hotpost-camera-feed').classList.add('hidden');
    document.getElementById('hotpost-preview-container').classList.remove('hidden');
    document.getElementById('capture-ui').classList.add('hidden');
    document.getElementById('preview-ui').classList.remove('hidden');
    document.getElementById('preview-ui').classList.add('flex');
    document.getElementById('switch-hotpost-camera-btn').classList.add('hidden');
    document.getElementById('editor-tools-container').classList.remove('hidden');
    document.getElementById('editor-tools-container').classList.add('flex');
}

// ==========================================
// EDITOR: FONT & TEXT ENGINE
// ==========================================
function activateTextTool(textId = null) {
    // 🚀 Failsafe: Ensure ID is strictly a string (prevents ghost empty boxes from accidental touch events)
    activeTextId = typeof textId === 'string' ? textId : null;
    
    const overlay = document.getElementById('hotpost-text-editor-overlay');
    const textarea = document.getElementById('hotpost-in-ui-textarea');
    
    overlay.classList.replace('hidden', 'flex');
    if (activeTextId) {
        const textObj = textElements.find(t => t.id === activeTextId);
        textarea.value = textObj ? textObj.content : '';
        currentTextFont = textObj.font || TEXT_FONTS[0].value;
        currentTextColor = textObj.color || '#FFFFFF';
        currentTextBg = textObj.hasBg || false;
        currentTextAlign = textObj.align || 'center';
        
        textarea.style.width = textObj ? `${textObj.width}px` : '85vw'; 
    } else {
        textarea.value = '';
        currentTextFont = TEXT_FONTS[0].value;
        currentTextColor = '#FFFFFF';
        currentTextBg = false;
        currentTextAlign = 'center';
        
        textarea.style.width = '85vw'; 
    }

    const alignBtnSpan = document.querySelector('#toggle-text-align-btn span');
    if (alignBtnSpan) alignBtnSpan.textContent = `format_align_${currentTextAlign}`;

    // Auto-expanding height logic for a perfect typing experience
    const adjustHeight = () => {
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    };
    textarea.removeEventListener('input', adjustHeight);
    textarea.addEventListener('input', adjustHeight);

    updateTextUIPreview();
    setTimeout(() => {
        textarea.focus();
        adjustHeight(); // Initial height calculation
    }, 50);
}

// 🚀 RESTORED MISSING FUNCTION: Handles Live UI Updates for Fonts, Alignment & Colors
function updateTextUIPreview() {
    const textarea = document.getElementById('hotpost-in-ui-textarea');
    
    // Force Font & Alignment updates overriding stubborn CSS
    textarea.style.setProperty('font-family', currentTextFont.replace(/"/g, "'"), 'important');
    textarea.style.setProperty('text-align', currentTextAlign, 'important');
    
    const isNeon = currentTextFont === TEXT_FONTS[2].value;

    if (currentTextBg) {
        textarea.style.setProperty('background-color', currentTextColor, 'important');
        textarea.style.setProperty('color', getContrastYIQ(currentTextColor), 'important');
        textarea.style.setProperty('text-shadow', 'none', 'important');
        textarea.style.setProperty('padding', '10px', 'important');
        textarea.style.setProperty('border-radius', '12px', 'important');
    } else {
        textarea.style.setProperty('background-color', 'transparent', 'important');
        textarea.style.setProperty('padding', '0', 'important');
        textarea.style.setProperty('color', currentTextColor, 'important');
        
        if (isNeon) {
            textarea.style.setProperty('text-shadow', `0 0 10px ${currentTextColor}, 0 0 20px ${currentTextColor}`, 'important');
        } else {
            textarea.style.setProperty('text-shadow', '0 4px 16px rgba(0,0,0,0.9)', 'important');
        }
    }
    
    // Update Button Selection States
    document.querySelectorAll('.text-color-btn').forEach(btn => {
        btn.style.transform = btn.dataset.color === currentTextColor ? 'scale(1.2)' : 'scale(1)';
        btn.style.border = btn.dataset.color === currentTextColor ? '2px solid white' : (btn.dataset.color === '#FFFFFF' ? '2px solid #ccc' : '2px solid transparent');
    });

    document.querySelectorAll('.text-font-btn').forEach(btn => {
        const idx = btn.dataset.fontindex;
        const isSelected = TEXT_FONTS[idx].value === currentTextFont;
        btn.style.backgroundColor = isSelected ? 'white' : 'rgba(255,255,255,0.2)';
        btn.style.color = isSelected ? 'black' : 'white';
    });

    const bgBtn = document.getElementById('toggle-text-bg-btn');
    if (bgBtn) {
        bgBtn.style.backgroundColor = currentTextBg ? 'white' : 'transparent';
        bgBtn.style.color = currentTextBg ? 'black' : 'white';
    }
}

function saveTextFromUI() {
    const textarea = document.getElementById('hotpost-in-ui-textarea');
    const content = textarea.value.trim();
    
    if (content) {
        if (activeTextId) {
            const textObj = textElements.find(t => t.id === activeTextId);
            if (textObj) {
                textObj.content = content;
                textObj.font = currentTextFont;
                textObj.color = currentTextColor;
                textObj.hasBg = currentTextBg;
                textObj.align = currentTextAlign;
            }
        } else {
            const newId = 'text-' + Date.now();
            
            // 🚀 Capture the actual full-screen pixel width to save to the Canvas properly
            const computedWidth = textarea.getBoundingClientRect().width || (window.innerWidth * 0.85);

            textElements.push({ 
                id: newId, 
                content: content, 
                x: 0.5, 
                y: 0.5, 
                width: computedWidth, 
                scale: 1.0,
                font: currentTextFont,
                color: currentTextColor,
                hasBg: currentTextBg,
                align: currentTextAlign
            });
            activeTextId = newId; 
        }
    } else if (activeTextId) {
        textElements = textElements.filter(t => t.id !== activeTextId);
    }
    
    renderTextElements();
    document.getElementById('hotpost-text-editor-overlay').classList.replace('flex', 'hidden');
}

function renderTextElements() {
    const container = document.getElementById('hotpost-preview-container');
    container.querySelectorAll('.text-widget').forEach(el => el.remove());

    textElements.forEach(tObj => {
        const isActive = activeTextId === tObj.id;
        const widget = document.createElement('div');
        widget.className = `text-widget ${isActive ? 'active' : ''}`;
        widget.id = tObj.id;
        widget.style.left = `${tObj.x * 100}%`;
        widget.style.top = `${tObj.y * 100}%`;
        widget.style.transform = `translate(-50%, -50%) scale(${tObj.scale})`;

        const isNeon = tObj.font === TEXT_FONTS[2].value;
        let bgCSS = '';
        let shadowCSS = '';
        
        // 🚀 Mapped Flexbox alignments matching user choice
        const alignMap = { left: 'flex-start', right: 'flex-end', center: 'center' };
        const flexAlign = alignMap[tObj.align || 'center'];

        if (tObj.hasBg) {
            bgCSS = `background-color: ${tObj.color}; color: ${getContrastYIQ(tObj.color)}; padding: 6px 12px; border-radius: 8px;`;
            shadowCSS = `text-shadow: none;`;
        } else {
            bgCSS = `color: ${tObj.color};`;
            if (isNeon) {
                shadowCSS = `text-shadow: 0 0 10px ${tObj.color}, 0 0 20px ${tObj.color};`;
            } else {
                shadowCSS = `text-shadow: 0 4px 16px rgba(0,0,0,0.9);`;
            }
        }

      widget.innerHTML = `
            <div class="text-widget-box">
                <div class="text-handle handle-tl" data-action="delete"><span class="material-symbols-outlined text-[18px]">close</span></div>
                <div class="text-handle handle-tr" data-action="edit"><span class="material-symbols-outlined text-[16px]">edit</span></div>
                <div class="text-handle handle-bl" data-action="duplicate"><span class="material-symbols-outlined text-[16px]">content_copy</span></div>
                <div class="text-handle handle-br" data-action="scale"><span class="material-symbols-outlined text-[18px]">open_in_full</span></div>
                <div class="text-handle handle-rm" data-action="width"></div>
                <!-- 🚀 Removed Flexbox to fix Webkit jagged background alignment bug -->
                <div class="text-widget-content" style="width: ${tObj.width}px; font-size: 24px; font-family: ${tObj.font.replace(/"/g, "'")}; text-align: ${tObj.align || 'center'}; line-height: 1.3;">
                    <span style="${bgCSS} ${shadowCSS} box-decoration-break: clone; -webkit-box-decoration-break: clone;">${tObj.content}</span>
                </div>
            </div>
        `;
        container.appendChild(widget);
    });
}

function initDoodleCanvas() {
    setTimeout(() => {
        const canvas = document.getElementById('hotpost-doodle-canvas');
        const container = document.getElementById('hotpost-preview-container');
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }, 100);
}

function toggleDrawMode() {
    isDrawMode = !isDrawMode;
    const colorPicker = document.getElementById('doodle-color-picker');
    const slider = document.getElementById('doodle-size-slider');
    const penBtn = document.getElementById('doodle-hotpost-btn');
    
    if (isDrawMode) {
        colorPicker.classList.replace('hidden', 'flex');
        slider.classList.remove('hidden');
        penBtn.classList.replace('bg-black/40', 'bg-white');
        penBtn.classList.replace('text-white', 'text-black');
    } else {
        colorPicker.classList.replace('flex', 'hidden');
        slider.classList.add('hidden');
        penBtn.classList.replace('bg-white', 'bg-black/40');
        penBtn.classList.replace('text-black', 'text-white');
    }
}

function setDoodleColor(color) {
    currentDoodleColor = color;
    document.querySelectorAll('.doodle-color-btn').forEach(btn => btn.classList.remove('scale-125'));
    const activeBtn = document.querySelector(`.doodle-color-btn[data-color="${color}"]`);
    if(activeBtn) activeBtn.classList.add('scale-125');
}

function undoLastDoodle() {
    if (doodlePaths.length > 0) {
        doodlePaths.pop();
        redrawDoodleCanvas();
    }
}

function redrawDoodleCanvas() {
    const canvas = document.getElementById('hotpost-doodle-canvas');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    doodlePaths.forEach(pathObj => {
        ctx.lineWidth = pathObj.width || 6;
        ctx.strokeStyle = pathObj.color;
        ctx.shadowColor = pathObj.color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        pathObj.points.forEach((point, index) => {
            if (index === 0) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
    });
}

function setupEditorTouchPhysics() {
    const container = document.getElementById('hotpost-preview-container');
    
    let touchMode = 'idle'; 
    let startX = 0, startY = 0;
    let initialObjWidth = 0;
    let widgetCenterX = 0, widgetCenterY = 0;

    const getPinchDistance = (touches) => {
        return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    };

    container.addEventListener('touchstart', (e) => {
        const handle = e.target.closest('.text-handle');
        const widget = e.target.closest('.text-widget');

   if (handle) {
            e.stopPropagation(); 
            touchMode = handle.dataset.action; 
            
            // 🚀 CRITICAL FIX: Ensure activeTextId is locked to the widget being edited
            activeTextIdForTouch = widget.id;
            activeTextId = widget.id;

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;

            if (touchMode === 'delete') {
                textElements = textElements.filter(t => t.id !== activeTextIdForTouch);
                activeTextId = null;
                const widgetEl = document.getElementById(activeTextIdForTouch);
                if (widgetEl) widgetEl.remove();
                touchMode = 'idle';
            } else if (touchMode === 'edit') {
                activateTextTool(activeTextIdForTouch); // Now correctly passes the ID!
                touchMode = 'idle';
            } else if (touchMode === 'duplicate') {
                const tObj = textElements.find(t => t.id === activeTextIdForTouch);
                const newId = 'text-' + Date.now();
                textElements.push({...tObj, id: newId, y: tObj.y + 0.08});
                activeTextId = newId;
                renderTextElements(); 
                touchMode = 'idle';
            } else {
                const tObj = textElements.find(t => t.id === activeTextIdForTouch);
                initialObjWidth = tObj.width;
                initialTextScale = tObj.scale;
                const rect = container.getBoundingClientRect();
                widgetCenterX = rect.left + (rect.width * tObj.x);
                widgetCenterY = rect.top + (rect.height * tObj.y);
                initialPinchDist = Math.hypot(startX - widgetCenterX, startY - widgetCenterY);
            }
            return;
        }
        
      if (widget && !isDrawMode) {
            // 🚀 If the text is already selected, tapping it again instantly opens the editor
            if (widget.classList.contains('active') && !handle) {
                activateTextTool(widget.id);
                touchMode = 'idle';
                return;
            }
            
            touchMode = 'drag_text';
            activeTextIdForTouch = widget.id;
            activeTextId = widget.id; 
            
            document.querySelectorAll('.text-widget').forEach(el => el.classList.remove('active'));
            widget.classList.add('active');

            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            if(tObj) {
                textInitialObjX = tObj.x;
                textInitialObjY = tObj.y;
            }
            return;
        }
        
        activeTextId = null;
        activeTextIdForTouch = null;
        document.querySelectorAll('.text-widget').forEach(el => el.classList.remove('active'));

        if (e.touches.length === 2 && !isDrawMode) {
            touchMode = 'zoom_bg';
            initialPinchDist = getPinchDistance(e.touches);
            initialBgScale = imgTransform.scale;
            return;
        }

        if (e.touches.length > 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;

        if (isDrawMode) {
            touchMode = 'draw';
            isDrawing = true;
            const rect = container.getBoundingClientRect();
            currentPath = [{ x: startX - rect.left, y: startY - rect.top }];
        } else {
            touchMode = imgTransform.scale > 1.0 ? 'pan_bg' : 'swipe';
            bgDragStartX = startX;
            bgDragStartY = startY;
        }
    }, { passive: false });

    container.addEventListener('touchmove', (e) => {
        if (e.cancelable) e.preventDefault(); 
        if (e.touches.length > 1 && touchMode !== 'zoom_bg') return;

        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const rect = container.getBoundingClientRect();

        if (touchMode === 'width') {
            const deltaX = currentX - startX;
            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            const adjustedDelta = (deltaX * 2) / tObj.scale; 
            tObj.width = Math.max(80, initialObjWidth + adjustedDelta);
            
            const widgetEl = document.getElementById(activeTextIdForTouch);
            if(widgetEl) {
                const contentEl = widgetEl.querySelector('.text-widget-content');
                if(contentEl) contentEl.style.width = `${tObj.width}px`;
            }
            return;
        }

        if (touchMode === 'scale') {
            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            const currentDist = Math.hypot(currentX - widgetCenterX, currentY - widgetCenterY);
            const scaleChange = currentDist / initialPinchDist;
            tObj.scale = Math.max(0.3, Math.min(6.0, initialTextScale * scaleChange));
            
            const widgetEl = document.getElementById(activeTextIdForTouch);
            if(widgetEl) widgetEl.style.transform = `translate(-50%, -50%) scale(${tObj.scale})`;
            return;
        }

        if (touchMode === 'drag_text' && activeTextIdForTouch) {
            const tObj = textElements.find(t => t.id === activeTextIdForTouch);
            if (tObj) {
                const deltaX = (currentX - startX) / rect.width;
                const deltaY = (currentY - startY) / rect.height;
                tObj.x = Math.max(-0.2, Math.min(1.2, textInitialObjX + deltaX)); 
                tObj.y = Math.max(-0.2, Math.min(1.2, textInitialObjY + deltaY));
                
                const widgetEl = document.getElementById(activeTextIdForTouch);
                if(widgetEl) {
                    widgetEl.style.left = `${tObj.x * 100}%`;
                    widgetEl.style.top = `${tObj.y * 100}%`;
                }
            }
            return;
        } 

        if (touchMode === 'zoom_bg' && e.touches.length === 2) {
            const currentDist = getPinchDistance(e.touches);
            const scaleChange = currentDist / initialPinchDist;
            imgTransform.scale = Math.max(1.0, Math.min(4.0, initialBgScale * scaleChange));
            if (imgTransform.scale === 1.0) { imgTransform.x = 0; imgTransform.y = 0; }
            document.getElementById('hotpost-preview-img').style.transform = `translate(${imgTransform.x}px, ${imgTransform.y}px) scale(${imgTransform.scale})`;
            return;
        }

        if (touchMode === 'pan_bg') {
            imgTransform.x += currentX - bgDragStartX;
            imgTransform.y += currentY - bgDragStartY;
            bgDragStartX = currentX;
            bgDragStartY = currentY;
            document.getElementById('hotpost-preview-img').style.transform = `translate(${imgTransform.x}px, ${imgTransform.y}px) scale(${imgTransform.scale})`;
            return;
        }

        if (touchMode === 'draw' && isDrawing) {
            currentPath.push({ x: currentX - rect.left, y: currentY - rect.top });
            const ctx = document.getElementById('hotpost-doodle-canvas').getContext('2d');
            ctx.lineJoin = "round"; ctx.lineCap = "round"; 
            ctx.lineWidth = currentDoodleWidth; 
            ctx.strokeStyle = currentDoodleColor; ctx.shadowColor = currentDoodleColor; ctx.shadowBlur = 4;
            
            ctx.beginPath();
            const prev = currentPath[currentPath.length - 2];
            const curr = currentPath[currentPath.length - 1];
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
        }
    }, { passive: false });
    
    container.addEventListener('touchend', (e) => {
        if (touchMode === 'draw' && isDrawing) {
            isDrawing = false;
            if (currentPath.length > 1) doodlePaths.push({ color: currentDoodleColor, width: currentDoodleWidth, points: [...currentPath] });
            currentPath = [];
        }
        else if (touchMode === 'swipe' && !isDrawMode) {
            const endX = e.changedTouches[0].clientX;
            const deltaX = endX - startX;

            if (Math.abs(deltaX) > 60) {
                if (deltaX < 0) currentFilterIndex = (currentFilterIndex + 1) % FILTER_LIST.length; 
                else currentFilterIndex = (currentFilterIndex - 1 + FILTER_LIST.length) % FILTER_LIST.length; 
                
                const filter = FILTER_LIST[currentFilterIndex];
                document.getElementById('hotpost-preview-img').style.filter = filter.css;
                showFilterToast(filter.name);
            }
        }
        
        if (e.touches.length === 0) {
            touchMode = 'idle';
        }
    }, { passive: true });
}

function showFilterToast(name) {
    const toast = document.getElementById('filter-name-toast');
    toast.textContent = name;
    toast.classList.remove('hidden');
    toast.style.animation = 'none';
    toast.offsetHeight; 
    toast.style.animation = 'fadeOutUp 1s ease-out forwards';
}

// ==========================================
// BACKGROUND UPLOADING ENGINE 
// ==========================================
async function submitHotpost() {
    if (!currentPhotoBlob) return;

    const visibilityBtn = document.getElementById('hotpost-send-visibility');
    const rewatchBtn = document.getElementById('hotpost-rewatch-toggle');
    const visibility = visibilityBtn ? visibilityBtn.dataset.val : 'everyone';
    const allowRewatch = rewatchBtn ? rewatchBtn.dataset.val === 'true' : true; // 🚀 Failsafe Defaults to True

    const previewContainer = document.getElementById('hotpost-preview-container');
    const screenW = previewContainer.clientWidth;
    const screenH = previewContainer.clientHeight;

    isUploadingBackground = true;
    renderHotpostCircles(); 
    closeCameraModal(true);
    
    try {
        const getCompiledBlob = () => new Promise((resolve, reject) => {
            try {
                const bakeCanvas = document.createElement('canvas');
                
                const MAX_HEIGHT = 1280;
                const scaleFactor = MAX_HEIGHT / screenH;
                const finalWidth = screenW * scaleFactor;
                const finalHeight = MAX_HEIGHT;

                bakeCanvas.width = finalWidth;
                bakeCanvas.height = finalHeight;
                const ctx = bakeCanvas.getContext('2d');

                ctx.save();
                ctx.translate(finalWidth / 2, finalHeight / 2);
                ctx.scale(imgTransform.scale, imgTransform.scale);
                ctx.translate(imgTransform.x * scaleFactor, imgTransform.y * scaleFactor);
                
                if (FILTER_LIST[currentFilterIndex].css !== 'none') {
                    ctx.filter = FILTER_LIST[currentFilterIndex].css;
                }
                
                const imgAspect = baseImageObj.width / baseImageObj.height;
                const screenAspect = finalWidth / finalHeight;
                let drawW, drawH;
                
                if (imgAspect > screenAspect) {
                    drawH = finalHeight;
                    drawW = finalHeight * imgAspect;
                } else {
                    drawW = finalWidth;
                    drawH = finalWidth / imgAspect;
                }
                
                ctx.drawImage(baseImageObj, -drawW / 2, -drawH / 2, drawW, drawH);
                ctx.restore();

                const doodleCanvas = document.getElementById('hotpost-doodle-canvas');
                if (doodlePaths.length > 0) {
                    ctx.drawImage(doodleCanvas, 0, 0, finalWidth, finalHeight);
                }
// 🚀 TEXT BACKGROUND, FONT, AND ALIGNMENT COMPILER
                textElements.forEach(tObj => {
                    ctx.save(); 

                    const baseFontSize = 24; 
                    ctx.font = `800 ${baseFontSize}px ${tObj.font}`;
                    ctx.textAlign = tObj.align || 'center'; // Apply requested alignment
                    ctx.textBaseline = "middle";
                    
                    const maxWidth = tObj.width || 250; 
                    
                    const paragraphs = tObj.content.split('\n');
                    let wrappedLines = [];
                    
                    paragraphs.forEach(paragraph => {
                        if (!paragraph) { wrappedLines.push(''); return; }
                        const words = paragraph.split(' ');
                        let currentLine = '';
                        for (let i = 0; i < words.length; i++) {
                            const testLine = currentLine + words[i] + ' ';
                            const metrics = ctx.measureText(testLine);
                            
                            if (metrics.width > maxWidth && currentLine.length > 0) {
                                wrappedLines.push(currentLine.trim());
                                currentLine = words[i] + ' ';
                            } else {
                                currentLine = testLine;
                            }
                        }
                        wrappedLines.push(currentLine.trim());
                    });

                    const finalX = finalWidth * tObj.x;
                    const finalY = finalHeight * tObj.y;

                    ctx.translate(finalX, finalY);
                    ctx.scale(scaleFactor * tObj.scale, scaleFactor * tObj.scale);

                    const isNeon = tObj.font === TEXT_FONTS[2].value;
                    const lineHeight = baseFontSize * 1.3; 
                    const totalHeight = wrappedLines.length * lineHeight;
                    const startY = -(totalHeight / 2) + (lineHeight / 2);

                    // Calculate X rendering offset based on alignment
                    let textDrawX = 0;
                    if (tObj.align === 'left') textDrawX = -(maxWidth / 2);
                    if (tObj.align === 'right') textDrawX = (maxWidth / 2);

                    // 1. Render Backgrounds (If enabled)
                    if (tObj.hasBg) {
                        ctx.fillStyle = tObj.color;
                        ctx.shadowColor = "transparent";
                        ctx.shadowBlur = 0;
                        
                        wrappedLines.forEach((line, index) => {
                            if(!line) return; 
                            const metrics = ctx.measureText(line);
                            const lineW = metrics.width;
                            const lineY = startY + (index * lineHeight);
                            const px = 12; 
                            const py = 6;  
                            
                            // Align background box dynamically
                            let bgStartX = 0;
                            if (tObj.align === 'center') bgStartX = -lineW/2 - px;
                            if (tObj.align === 'left') bgStartX = textDrawX - px;
                            if (tObj.align === 'right') bgStartX = textDrawX - lineW - px;
                            
                            ctx.beginPath();
                            ctx.roundRect(bgStartX, lineY - (lineHeight/2) - py, lineW + (px*2), lineHeight + (py*2), 8);
                            ctx.fill();
                        });

                        ctx.fillStyle = getContrastYIQ(tObj.color);
                    } else {
                        ctx.fillStyle = tObj.color;
                        if (isNeon) {
                            ctx.shadowColor = tObj.color;
                            ctx.shadowBlur = 10;
                        } else {
                            ctx.shadowColor = "rgba(0,0,0,0.9)";
                            ctx.shadowBlur = 10; 
                        }
                    }

                    // 2. Render Text
                    wrappedLines.forEach((line, index) => {
                        const lineY = startY + (index * lineHeight);
                        if (!tObj.hasBg && isNeon) ctx.fillText(line, textDrawX, lineY); 
                        ctx.fillText(line, textDrawX, lineY); 
                    });

                    ctx.restore(); 
                });

                bakeCanvas.toBlob(resolve, 'image/webp', 0.65); 
            } catch (err) {
                reject(err);
            }
        });

        const finalBlob = await getCompiledBlob();

        const formData = new FormData();
        formData.append('file', finalBlob, 'hotpost.webp');
        formData.append('upload_preset', CLOUDINARY_HOTPOSTS_PRESET);

        const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);

        const { data: newHotpost, error } = await supabase.from('hotposts').insert({
            user_id: currentUser.id,
            media_url: data.secure_url,
            media_type: 'image',
            visibility: visibility,
            allow_rewatch: allowRewatch
        }).select('id').single();

        if (error) throw error;

        if (currentUser.role === 'page' && newHotpost) {
            await supabase.rpc('notify_page_followers', {
                p_page_id: currentUser.id, p_type: 'page_new_hotpost',
                p_message: 'added a new hotpost.', p_target_id: newHotpost.id
            });
        }

        showToast('Hotpost published!', 'success');

    } catch (error) {
        console.error("Hotpost Compile Error:", error);
        showToast('Failed to publish hotpost.', 'error');
    } finally {
        isUploadingBackground = false;
        resetCameraUI(); 
        fetchHotposts(); 
    }
}

window.toggleRewatchSetting = function() {
    const btn = document.getElementById('hotpost-rewatch-toggle');
    const icon = document.getElementById('rewatch-icon');
    
    if(btn.dataset.val === 'false') {
        btn.dataset.val = 'true';
        icon.textContent = 'all_inclusive';
        showToast('Rewatch Allowed (Post will stay for 24hrs)', 'info');
    } else {
        btn.dataset.val = 'false';
        icon.textContent = 'looks_one';
        showToast('Play Once (Post disappears after viewing)', 'info');
    }
};

window.toggleVisibilitySetting = function() {
    const btn = document.getElementById('hotpost-send-visibility');
    const icon = document.getElementById('visibility-icon');
    if(btn.dataset.val === 'everyone') {
        btn.dataset.val = 'connections';
        icon.textContent = 'stars';
        btn.classList.replace('bg-black/50', 'bg-green-500/80');
    } else {
        btn.dataset.val = 'everyone';
        icon.textContent = 'public';
        btn.classList.replace('bg-green-500/80', 'bg-black/50');
    }
};

// ==========================================
// DASHBOARD VIEW & CIRCLES
// ==========================================
async function fetchHotposts() {
    const container = document.querySelector('#hotposts-container');
    if (!container) return;
    
    if (!isUploadingBackground) container.innerHTML = HOTPOST_SKELETON;

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const blockedIds = await window.getBlockedUserIds(currentUser.id);

    let query = supabase
        .from('hotposts')
        .select(`
            id, created_at, media_url, visibility, user_id, allow_rewatch,
            users!inner ( id, full_name, profile_img_url, tick_type, is_deleted, is_deactivated ),
            hotpost_views ( viewer_id )
        `)
        .gt('created_at', twentyFourHoursAgo)
        .eq('is_deleted', false)
        .eq('users.is_deleted', false)
        .eq('users.is_deactivated', false)
        .order('created_at', { ascending: false });
    
    if (blockedIds.length > 0) {
        query = query.not('user_id', 'in', `(${blockedIds.join(',')})`);
    }

    const { data, error } = await query;
    if (error) return;

    const unviewedData = data.filter(post => {
        if (post.user_id === currentUser.id) return true; 
        const hasViewed = post.hotpost_views.some(v => v.viewer_id === currentUser.id);
        
        if (!hasViewed) return true; 
        if (hasViewed && post.allow_rewatch) return true; 
        return false; 
    });

    hotpostsByUser.clear();
    for (const post of unviewedData) {
        const userId = post.users.id;
        if (!hotpostsByUser.has(userId)) {
            hotpostsByUser.set(userId, { user: post.users, posts: [], viewed: true });
        }
        
        const hasViewed = post.hotpost_views.some(v => v.viewer_id === currentUser.id);
        if (!hasViewed && post.user_id !== currentUser.id) {
            hotpostsByUser.get(userId).viewed = false; 
        }
        
        hotpostsByUser.get(userId).posts.unshift({ ...post, users: undefined }); 
    }

    renderHotpostCircles();
}

function renderHotpostCircles() {
    const container = document.querySelector('#view-dashboard .flex.gap-4.overflow-x-auto');
    if (!container) return;
    container.innerHTML = ''; 

    const addCircle = document.createElement('div');
    addCircle.className = 'hotpost-circle flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform relative z-20';
    
    if (isUploadingBackground) {
        addCircle.innerHTML = `
            <div class="w-[80px] h-[80px] relative flex items-center justify-center pointer-events-none shadow-sm">
                <div class="absolute inset-0 rounded-full hotpost-uploading-ring"></div>
                <div class="w-[74px] h-[74px] rounded-full border-2 border-white dark:border-[#121212] overflow-hidden bg-gray-100 dark:bg-neutral-800 z-10">
                    <img src="${currentUser.profile_img_url}" class="w-full h-full object-cover opacity-60">
                </div>
            </div>
            <span class="text-[11px] font-bold text-on-surface-variant dark:text-gray-400">Uploading...</span>
        `;
    } else {
        addCircle.innerHTML = `
            <div class="w-[80px] h-[80px] rounded-full p-[2.5px] bg-transparent shadow-sm relative">
                <div class="w-full h-full rounded-full border-2 border-surface-variant dark:border-neutral-700 overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img src="${currentUser.profile_img_url}" class="w-full h-full object-cover opacity-60">
                </div>
                <div class="absolute bottom-0 right-0 w-7 h-7 bg-primary text-white rounded-full border-[2.5px] border-white dark:border-[#121212] flex items-center justify-center z-30 shadow-sm">
                    <span class="material-symbols-outlined text-[16px] font-bold">add</span>
                </div>
            </div>
            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">Create</span>
        `;
        addCircle.addEventListener('click', openCameraModal);
    }
    container.appendChild(addCircle);

    const myData = hotpostsByUser.get(currentUser.id);
    if (myData && myData.posts.length > 0) {
        const myCircle = document.createElement('div');
        myCircle.className = 'hotpost-circle flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform relative z-10';
        const ringClass = myData.viewed ? 'from-gray-300 to-gray-400' : 'from-gray-400 to-gray-600';
        myCircle.innerHTML = `
            <div class="w-[80px] h-[80px] rounded-full p-[2.5px] bg-gradient-to-tr ${ringClass} shadow-sm relative">
                <div class="w-full h-full rounded-full border-2 border-white dark:border-neutral-900 overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img src="${currentUser.profile_img_url}" class="w-full h-full object-cover">
                </div>
            </div>
            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">My Hotposts</span>
        `;
        myCircle.addEventListener('click', () => openHotpostViewer(currentUser.id));
        container.appendChild(myCircle);
    }

    const otherUserIds = Array.from(hotpostsByUser.keys()).filter(id => id !== currentUser.id);
    otherUserIds.sort((a, b) => (hotpostsByUser.get(a).viewed || false) - (hotpostsByUser.get(b).viewed || false));

    otherUserIds.forEach(userId => {
        const data = hotpostsByUser.get(userId);
        const user = data.user;
        const circle = document.createElement('div');
        circle.className = 'hotpost-circle flex flex-col items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-transform relative z-10';

        const ringClass = data.viewed ? 'from-gray-300 to-gray-400' : 'from-yellow-400 via-orange-500 to-red-500';

        circle.innerHTML = `
            <div class="w-[80px] h-[80px] rounded-full p-[2.5px] bg-gradient-to-tr ${ringClass} shadow-sm">
                <div class="w-full h-full rounded-full border-2 border-white dark:border-neutral-900 overflow-hidden bg-gray-100 dark:bg-neutral-800">
                    <img src="${user.profile_img_url}" class="w-full h-full object-cover">
                </div>
            </div>
            <span class="text-[11px] font-bold text-gray-900 dark:text-gray-100">${user.full_name.split(' ')[0]}</span>
        `;
        circle.addEventListener('click', () => openHotpostViewer(userId));
        container.appendChild(circle);
    });

    setTimeout(() => {
        if (window.requestIdleCallback) {
            window.requestIdleCallback(preloadHotpostImages);
        } else {
            preloadHotpostImages();
        }
    }, 1000); 
}

function preloadHotpostImages() {
    hotpostsByUser.forEach((data) => {
        if (data.posts && data.posts.length > 0) {
            const firstPostUrl = data.posts[0].media_url;
            const optimizedUrl = typeof window.optimizeImageUrl === 'function' 
                ? window.optimizeImageUrl(firstPostUrl, 'hotpost') 
                : firstPostUrl;
            
            const img = new Image();
            img.src = optimizedUrl;
        }
    });
}

// ==========================================
// VIEWER ENGINES & PHYSICS
// ==========================================
function setupViewerTouchPhysics() {
    const viewer = document.getElementById('modal-view-hotpost');
    const viewerContent = document.getElementById('hotpost-viewer-content');
    const activityModal = document.getElementById('modal-story-details');
    const activitySheet = document.getElementById('modal-story-details-sheet');
    
    let viewerStartY = 0;
    let isDraggingViewer = false;

    let panelStartY = 0;
    let isDraggingPanel = false;
    let isPanelScrollable = false;

    viewer?.addEventListener('touchstart', (e) => {
        if (!activityModal.classList.contains('hidden')) return;
        
        // 🚀 CRITICAL FIX: Tell the drag engine to ignore touches on the Avatar & Name!
        const isIgnoredTarget = 
            e.target.closest('button:not(#hotpost-activity-btn)') || 
            e.target.closest('input') || 
            e.target.closest('#hotpost-viewer-avatar') || 
            e.target.closest('#hotpost-viewer-name');
            
        if (isIgnoredTarget) return;
        
        viewerStartY = e.touches[0].clientY;
        isDraggingViewer = true;
        if (viewerContent) viewerContent.style.transition = 'none'; 
    }, { passive: true });
    
    viewer?.addEventListener('touchmove', (e) => {
        if (!isDraggingViewer) return;
        const deltaY = e.touches[0].clientY - viewerStartY;

        if (deltaY > 0) {
            const progress = Math.min(deltaY / window.innerHeight, 1);
            if (viewerContent) {
                viewerContent.style.transform = `translateY(${deltaY * 0.8}px) scale(${1 - (progress * 0.15)})`;
            }
            if (e.cancelable) e.preventDefault(); 
        } 
    }, { passive: false });

    viewer?.addEventListener('touchend', (e) => {
        if (!isDraggingViewer) return;
        isDraggingViewer = false;
        
        const deltaY = e.changedTouches[0].clientY - viewerStartY;
        const isActivityBtn = e.target.closest('#hotpost-activity-btn');
        
        const screenHeight = window.innerHeight;
        const startedAtBottom = viewerStartY > (screenHeight * 0.7);

        if (viewerContent) viewerContent.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';

        if (deltaY < -40 && currentViewerState.userId === currentUser.id && (startedAtBottom || isActivityBtn)) {
            if (viewerContent) viewerContent.style.transform = ''; 
            openActivityPanel();
        } 
        else if (deltaY > 100) {
            closeHotpostViewer();
        } 
        else {
            if (viewerContent) viewerContent.style.transform = '';
        }
    }, { passive: true });

    activitySheet?.addEventListener('touchstart', (e) => {
        const scrollArea = e.target.closest('.overflow-y-auto');
        if (scrollArea && scrollArea.scrollTop > 0) {
            isPanelScrollable = true;
            isDraggingPanel = false;
        } else {
            isPanelScrollable = false;
            panelStartY = e.touches[0].clientY;
            isDraggingPanel = true;
            activitySheet.style.transition = 'none'; 
            if (viewerContent) viewerContent.style.transition = 'none';
        }
    }, { passive: true });

    activitySheet?.addEventListener('touchmove', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        const deltaY = e.touches[0].clientY - panelStartY;
        
        if (deltaY > 0) {
            activitySheet.style.transform = `translateY(${deltaY}px)`;
            const progress = deltaY / window.innerHeight;
            if(viewerContent) {
                viewerContent.style.transform = `scale(${0.92 + (0.08 * progress)}) translateY(${2 - (2 * progress)}vh)`;
                viewerContent.style.opacity = 0.4 + (0.6 * progress);
            }
            if (e.cancelable) e.preventDefault(); 
        }
    }, { passive: false });

    activitySheet?.addEventListener('touchend', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        isDraggingPanel = false;
        
        const deltaY = e.changedTouches[0].clientY - panelStartY;
        
        activitySheet.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)'; 
        if(viewerContent) {
            viewerContent.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-radius 0.4s ease';
        }
        
        if (deltaY > 120) {
            closeActivityPanel();
        } 
        else {
            activitySheet.style.transform = `translateY(0px)`;
            if (viewerContent) {
                viewerContent.style.transform = '';
                viewerContent.style.opacity = '';
                viewerContent.classList.add('viewer-pushed-back');
            }
        }
    }, { passive: true });
}

function openHotpostViewer(userId) {
    const userData = hotpostsByUser.get(userId);
    if (!userData || userData.posts.length === 0) return;

    const allUserIds = Array.from(hotpostsByUser.keys())
        .filter(id => id !== currentUser.id)
        .sort((a, b) => (hotpostsByUser.get(a).viewed || false) - (hotpostsByUser.get(b).viewed || false));

    if (userId === currentUser.id) allUserIds.unshift(currentUser.id);

    const clickedUserIndex = allUserIds.indexOf(userId);
    currentViewerState.userOrder = [
        ...allUserIds.slice(clickedUserIndex),
        ...allUserIds.slice(0, clickedUserIndex)
    ];

    // 🚀 SMART INDEXING: Find the first unviewed post to start from
    let startPostIndex = 0;
    if (userId !== currentUser.id) {
        const firstUnviewedIndex = userData.posts.findIndex(p => {
            const hasViewed = p.hotpost_views?.some(v => v.viewer_id === currentUser.id) || sessionViewedPostIds.has(p.id);
            return !hasViewed; // Return true if NOT viewed
        });
        if (firstUnviewedIndex !== -1) startPostIndex = firstUnviewedIndex;
    }

    document.getElementById('modal-view-hotpost').classList.replace('hidden', 'flex');
    toggleCameraStatusBar(true); 
    playUserStories(0, startPostIndex); 
}

function closeHotpostViewer() {
    document.getElementById('modal-view-hotpost').classList.replace('flex', 'hidden');
    clearTimeout(currentViewerState.storyTimer);
    const activeBar = document.querySelector('#hotpost-progress-bars .progress-bar-inner.active');
    if (activeBar) activeBar.style.animation = 'none';
    
    const viewerContent = document.getElementById('hotpost-viewer-content');
    if (viewerContent) {
        viewerContent.style.transform = '';
        viewerContent.style.opacity = '';
        viewerContent.style.transition = '';
        viewerContent.classList.remove('viewer-pushed-back');
    }
    
    processStoryDisappear();
    toggleCameraStatusBar(false);
}

function processStoryDisappear() {
    const lastViewedUser = currentViewerState.userId;
    if (lastViewedUser && lastViewedUser !== currentUser.id) {
        const userData = hotpostsByUser.get(lastViewedUser);
        if (userData) {
            userData.posts = userData.posts.filter(p => {
                const viewed = p.hotpost_views?.some(v => v.viewer_id === currentUser.id) || sessionViewedPostIds.has(p.id);
                return !viewed || p.allow_rewatch;
            });
            
            if (userData.posts.length === 0) {
                hotpostsByUser.delete(lastViewedUser);
            } else {
                userData.viewed = true; 
            }
            renderHotpostCircles();
        }
    }
}

function playUserStories(userIndex, postIndex = 0) {
    if (userIndex >= currentViewerState.userOrder.length) {
        closeHotpostViewer();
        return;
    }

    currentViewerState.userIndex = userIndex;
    currentViewerState.postIndex = postIndex;
    currentViewerState.userId = currentViewerState.userOrder[userIndex];

    const userData = hotpostsByUser.get(currentViewerState.userId);
    const post = userData.posts[currentViewerState.postIndex];

    const progressContainer = document.getElementById('hotpost-progress-bars');
    progressContainer.innerHTML = userData.posts.map((p, index) => `
        <div class="flex-1 bg-white/30 rounded-full overflow-hidden">
            <div class="progress-bar-inner h-full bg-white rounded-full ${index < postIndex ? 'w-full' : ''}" data-index="${index}"></div>
        </div>
    `).join('');

    const isMyStory = currentViewerState.userId === currentUser.id;
    
    document.getElementById('hotpost-reply-container').style.display = isMyStory ? 'none' : 'flex';
    document.getElementById('hotpost-activity-btn').style.display = isMyStory ? 'flex' : 'none';
    
    const visIcon = document.getElementById('hotpost-viewer-visibility');
    if (post.visibility === 'connections') {
        visIcon.textContent = 'stars';
        visIcon.classList.add('text-green-400');
        visIcon.classList.remove('text-white/80');
    } else {
        visIcon.textContent = 'public';
        visIcon.classList.remove('text-green-400');
        visIcon.classList.add('text-white/80');
    }

    const likeBtnIcon = document.querySelector('#hotpost-like-btn span');
    if(likeBtnIcon) {
        likeBtnIcon.style.fontVariationSettings = "'FILL' 0";
        likeBtnIcon.classList.remove('text-red-500');
    }

    const getTickHtmlLocal = (tickType) => {
        if (!tickType || tickType === 'none') return '';
        const colors = { blue: 'text-[#1d9bf0]', gold: 'text-[#e8b339]', green: 'text-primary', gray: 'text-white/80' };
        return `<span class="material-symbols-outlined text-[14px] ${colors[tickType.toLowerCase()] || colors.blue}" style="font-variation-settings: 'FILL' 1;">verified</span>`;
    };

// 🚀 ULTRA-FAST PROFILE ROUTING
    const avatarEl = document.getElementById('hotpost-viewer-avatar');
    const nameEl = document.getElementById('hotpost-viewer-name');
    
    const openProfileHandler = (e) => {
        e.preventDefault();  // Stop any ghost clicks
        e.stopPropagation(); // Prevent the story from skipping to the next one
        
        closeHotpostViewer(); // Close the story viewer smoothly
        
        // 🚀 THE FIX: Trigger your app's native profile function!
        // We use a tiny delay (150ms) to let the story modal close cleanly before opening the profile
        setTimeout(() => {
            if (typeof window.viewUserProfile === 'function') {
                window.viewUserProfile(userData.user.id);
            }
        }, 150); 
    };

    // Apply strict Z-index and Pointer Events so the Next/Prev zones don't block them
    if (avatarEl) {
        avatarEl.src = userData.user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.user.full_name)}&background=e1e3e4`;
        avatarEl.onclick = openProfileHandler;
        avatarEl.classList.add('cursor-pointer', 'active:scale-90', 'transition-transform', 'relative', 'z-[100]', 'pointer-events-auto');
    }
    
    if (nameEl) {
        if (isMyStory) {
            nameEl.innerHTML = `Your Hotpost`;
        } else {
            nameEl.innerHTML = `${userData.user.full_name} ${getTickHtmlLocal(userData.user.tick_type)}`;
        }
        nameEl.onclick = openProfileHandler;
        nameEl.classList.add('cursor-pointer', 'active:scale-95', 'transition-opacity', 'relative', 'z-[100]', 'pointer-events-auto');
    }
    
    document.getElementById('hotpost-viewer-time').textContent = timeAgo(post.created_at);

    // 🚀 LOAD-SYNCED ENGINE (Waits for the image to paint before starting the timer)
    clearTimeout(currentViewerState.storyTimer);
    const activeBar = progressContainer.querySelector(`.progress-bar-inner[data-index="${postIndex}"]`);
    if (activeBar) activeBar.style.animation = 'none'; // Lock the progress bar

    const imgEl = document.getElementById('hotpost-viewer-image');
    const optimizedUrl = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(post.media_url, 'hotpost') : post.media_url;
    
    // Hide image while fetching so it doesn't flash the previous user's photo
    imgEl.style.opacity = '0';
    imgEl.style.transition = 'opacity 0.2s ease';

    imgEl.onload = () => {
        imgEl.style.opacity = '1'; // Fade in smoothly
        recordView(post.id);

        if (activeBar) {
            activeBar.style.animation = `fill-progress ${currentViewerState.storyDuration}ms linear forwards`;
            activeBar.classList.add('active');
        }

        currentViewerState.remainingDuration = currentViewerState.storyDuration; 
        currentViewerState.animationStartTime = performance.now();
        currentViewerState.storyTimer = setTimeout(nextStory, currentViewerState.storyDuration);
    };
    
    imgEl.src = optimizedUrl;
}

function nextStory() {
    const currentUserData = hotpostsByUser.get(currentViewerState.userId);
    if (currentViewerState.postIndex < currentUserData.posts.length - 1) {
        playUserStories(currentViewerState.userIndex, currentViewerState.postIndex + 1);
    } else {
        processStoryDisappear();
        playUserStories(currentViewerState.userIndex + 1, 0);
    }
}

function prevStory() {
    if (currentViewerState.postIndex > 0) {
        playUserStories(currentViewerState.userIndex, currentViewerState.postIndex - 1);
    } else if (currentViewerState.userIndex > 0) {
        const prevUserIndex = currentViewerState.userIndex - 1;
        const prevUserData = hotpostsByUser.get(currentViewerState.userOrder[prevUserIndex]);
        playUserStories(prevUserIndex, prevUserData.posts.length - 1);
    }
}

function pauseStory() {
    clearTimeout(currentViewerState.storyTimer);
    const activeBar = document.querySelector('#hotpost-progress-bars .progress-bar-inner.active');
    if (activeBar) {
        const elapsedTime = performance.now() - currentViewerState.animationStartTime;
        currentViewerState.remainingDuration -= elapsedTime;
        activeBar.style.animationPlayState = 'paused';
    }
}

function resumeStory() {
    if (document.getElementById('modal-view-hotpost').classList.contains('hidden')) return;
    if (!document.getElementById('modal-story-details').classList.contains('hidden')) return; 

    const activeBar = document.querySelector('#hotpost-progress-bars .progress-bar-inner.active');
    if (activeBar) activeBar.style.animationPlayState = 'running';
    
    currentViewerState.animationStartTime = performance.now(); 
    clearTimeout(currentViewerState.storyTimer);
    currentViewerState.storyTimer = setTimeout(nextStory, currentViewerState.remainingDuration);
}

// ==========================================
// ENGAGEMENT & ACTIVITY
// ==========================================
async function recordView(hotpostId) {
    if (currentViewerState.userId === currentUser.id) return;
    if (sessionViewedPostIds.has(hotpostId)) return;
    const { error } = await supabase.from('hotpost_views').insert({ hotpost_id: hotpostId, viewer_id: currentUser.id });
    if (!error) sessionViewedPostIds.add(hotpostId); 
}

async function handleLikeHotpost(event) {
    event.stopPropagation(); 
    const icon = event.currentTarget.querySelector('span');
    icon.style.fontVariationSettings = "'FILL' 1";
    icon.classList.add('text-red-500');
    
    const post = hotpostsByUser.get(currentViewerState.userId).posts[currentViewerState.postIndex];
    await supabase.from('hotpost_likes').insert({ hotpost_id: post.id, user_id: currentUser.id });
}

async function handleReplyToHotpost(event) {
    event.stopPropagation(); 
    const input = document.getElementById('hotpost-reply-input');
    const content = input.value.trim();
    if (!content) return;

    const userData = hotpostsByUser.get(currentViewerState.userId);
    const post = userData.posts[currentViewerState.postIndex];
    const replyBtn = document.getElementById('hotpost-reply-btn');
    const originalHtml = replyBtn.innerHTML;

    replyBtn.disabled = true;
    replyBtn.innerHTML = `<span class="material-symbols-outlined animate-spin text-white">progress_activity</span>`;

    const { error } = await supabase.from('hotpost_replies').insert({
        hotpost_id: post.id, replier_id: currentUser.id, author_id: userData.user.id, content: content
    });

    if (error) {
        showToast('Failed to send reply.', 'error');
        replyBtn.disabled = false;
        replyBtn.innerHTML = originalHtml;
    } else {
        showToast('Reply sent!', 'success');
        input.value = '';
        replyBtn.classList.add('!bg-green-500', 'border-transparent');
        replyBtn.innerHTML = `<span class="material-symbols-outlined text-white">check</span>`;
        setTimeout(() => {
            replyBtn.disabled = false;
            replyBtn.classList.remove('!bg-green-500', 'border-transparent');
            replyBtn.innerHTML = originalHtml;
            resumeStory();
        }, 1500);
    }
}

async function toggleCameraStatusBar(isCameraOpen) {
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const StatusBar = window.Capacitor.Plugins.StatusBar;
            if (!StatusBar) return;
            
            if (isCameraOpen) {
                await StatusBar.setBackgroundColor({ color: '#000000' });
                await StatusBar.setStyle({ style: 'DARK' });
            } else {
                const isDark = document.documentElement.classList.contains('dark');
                await StatusBar.setBackgroundColor({ color: isDark ? '#121212' : '#f8f9fa' });
                await StatusBar.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
            }
        } catch (e) { console.log('Status bar override bypassed.'); }
    }
}

function openActivityPanel() {
    pauseStory();
    const modal = document.getElementById('modal-story-details');
    const sheet = document.getElementById('modal-story-details-sheet');
    const viewerContent = document.getElementById('hotpost-viewer-content');
    
    if (viewerContent) {
        viewerContent.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-radius 0.4s ease';
        viewerContent.style.transform = '';
        viewerContent.style.opacity = '';
        viewerContent.classList.add('viewer-pushed-back');
    }

    modal.classList.replace('hidden', 'flex');
    setTimeout(() => sheet.style.transform = `translateY(0px)`, 10);

    const post = hotpostsByUser.get(currentUser.id).posts[currentViewerState.postIndex];
    switchDetailsTab('viewers');
    fetchStoryViewers(post.id);
    fetchStoryLikes(post.id);
    fetchStoryReplies(post.id);
}

function closeActivityPanel() {
    const modal = document.getElementById('modal-story-details');
    const sheet = document.getElementById('modal-story-details-sheet');
    const viewerContent = document.getElementById('hotpost-viewer-content');
    
    sheet.style.transform = `translateY(100%)`;
    modal.style.pointerEvents = 'none'; 
    
    if (viewerContent) {
        viewerContent.style.transition = 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease, border-radius 0.4s ease';
        viewerContent.style.transform = '';
        viewerContent.style.opacity = '';
        viewerContent.classList.remove('viewer-pushed-back');
    }

    setTimeout(() => {
        modal.classList.replace('flex', 'hidden');
        modal.style.pointerEvents = 'auto'; 
        resumeStory();
    }, 400); 
}

function switchDetailsTab(tabName) {
    document.querySelectorAll('.details-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`details-content-${tabName}`).classList.remove('hidden');

    document.querySelectorAll('.details-tab').forEach(el => {
        el.classList.remove('active', 'border-primary', 'text-primary');
        el.classList.add('border-transparent', 'text-on-surface-variant', 'dark:text-gray-400');
    });
    document.getElementById(`details-tab-${tabName}`).classList.add('active', 'border-primary', 'text-primary');
    document.getElementById(`details-tab-${tabName}`).classList.remove('text-on-surface-variant', 'dark:text-gray-400');
}

async function fetchStoryViewers(hotpostId) {
    const list = document.getElementById('hotpost-viewers-list');
    list.innerHTML = ACTIVITY_SKELETON; 
    try {
        const { data, error } = await supabase.from('hotpost_views').select('viewed_at, users!hotpost_views_viewer_id_fkey(full_name, profile_img_url)').eq('hotpost_id', hotpostId).eq('is_deleted', false).order('viewed_at', { ascending: false });
        if (error) throw error;
        document.getElementById('details-tab-viewers').innerHTML = `<span class="material-symbols-outlined text-[16px] mr-1 align-middle">visibility</span> ${data.length}`;
        if (data.length === 0) { list.innerHTML = `<p class="text-sm italic text-center py-8">No views yet.</p>`; return; }
        list.innerHTML = data.map(v => `<div class="flex items-center gap-3 p-3 bg-surface-variant/20 dark:bg-neutral-800/50 rounded-2xl"><img src="${v.users.profile_img_url}" class="w-10 h-10 rounded-full object-cover"><div class="flex-1"><p class="text-sm font-bold text-on-surface dark:text-gray-100">${v.users.full_name}</p></div><p class="text-xs text-on-surface-variant">${timeAgo(v.viewed_at)}</p></div>`).join('');
    } catch (e) { list.innerHTML = `<p class="text-sm text-center py-8 text-error">Failed.</p>`; }
}

async function fetchStoryLikes(hotpostId) {
    const list = document.getElementById('hotpost-likes-list');
    list.innerHTML = ACTIVITY_SKELETON; 
    try {
        const { data, error } = await supabase.from('hotpost_likes').select('created_at, users!hotpost_likes_user_id_fkey(full_name, profile_img_url)').eq('hotpost_id', hotpostId).eq('is_deleted', false).order('created_at', { ascending: false });
        if (error) throw error;
        document.getElementById('details-tab-likes').innerHTML = `<span class="material-symbols-outlined text-[16px] mr-1 align-middle">favorite</span> ${data.length}`;
        if (data.length === 0) { list.innerHTML = `<p class="text-sm italic text-center py-8">No likes yet.</p>`; return; }
        list.innerHTML = data.map(l => `<div class="flex items-center gap-3 p-3 bg-red-500/5 dark:bg-red-500/10 rounded-2xl border border-red-500/10"><img src="${l.users.profile_img_url}" class="w-10 h-10 rounded-full object-cover"><div class="flex-1"><p class="text-sm font-bold text-on-surface dark:text-gray-100">${l.users.full_name}</p></div><span class="material-symbols-outlined text-red-500" style="font-variation-settings: 'FILL' 1;">favorite</span></div>`).join('');
    } catch (e) { list.innerHTML = `<p class="text-sm text-center py-8 text-error">Failed.</p>`; }
}

async function fetchStoryReplies(hotpostId) {
    const list = document.getElementById('hotpost-replies-list');
    list.innerHTML = ACTIVITY_SKELETON; 
    try {
        const { data, error } = await supabase.from('hotpost_replies').select('created_at, content, users!hotpost_replies_replier_id_fkey(full_name, profile_img_url)').eq('hotpost_id', hotpostId).eq('is_deleted', false).order('created_at', { ascending: false });
        if (error) throw error;
        document.getElementById('details-tab-replies').innerHTML = `<span class="material-symbols-outlined text-[16px] mr-1 align-middle">reply</span> ${data.length}`;
        if (data.length === 0) { list.innerHTML = `<p class="text-sm italic text-center py-8">No replies yet.</p>`; return; }
        list.innerHTML = data.map(r => `<div class="flex items-start gap-3 p-3 bg-surface-variant/20 dark:bg-neutral-800/50 rounded-2xl"><img src="${r.users.profile_img_url}" class="w-9 h-9 rounded-full object-cover"><div class="flex-1"><div class="flex justify-between items-center mb-1"><p class="text-[13px] font-bold text-on-surface dark:text-gray-100">${r.users.full_name}</p><p class="text-[10px] text-on-surface-variant">${timeAgo(r.created_at)}</p></div><p class="text-[14px] text-on-surface dark:text-gray-300 whitespace-pre-wrap">${r.content}</p></div></div>`).join('');
    } catch (e) { list.innerHTML = `<p class="text-sm text-center py-8 text-error">Failed.</p>`; }
}

async function executeDeleteHotpost() {
    const post = hotpostsByUser.get(currentUser.id).posts[currentViewerState.postIndex];
    closeActivityPanel(); 
    closeHotpostViewer();
    const { error } = await supabase.from('hotposts').update({ is_deleted: true }).eq('id', post.id);
    if (error) showToast('Failed to delete Hotpost.', 'error');
    else { showToast('Hotpost deleted.', 'success'); fetchHotposts(); }
}

window.openHotpostCamera = openCameraModal;
window.openStoryDetailsModal = openActivityPanel;

window.openHotpostViewer = openHotpostViewer;
window.showMyHotposts = () => openHotpostViewer(currentUser.id);
window.refreshHotposts = fetchHotposts;
