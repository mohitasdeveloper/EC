import { initHotposts } from './hotposts.js';
import { showToast } from './ui.js';
import { timeAgo } from './utils.js';
import { supabase } from './supabase.js';
import { initFeed } from './feed.js';
import { initSearch } from './search.js';
import { initNotifications } from './notifications.js';
import { initUpdates } from './updates.js';
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_AVATARS_PRESET } from './config.js';

let currentUserProfile = null;
window.addEventListener('load', () => {
    // 1. Initialize the Pull-to-Refresh Engine
    // This allows the user to drag down to refresh the feed
    if (typeof initPullToRefresh === 'function') {
        initPullToRefresh();
    }

   // 2. Splash Screen Logic
    setTimeout(() => {
        const splash = document.getElementById('app-splash-screen');
        if (splash) {
            // 🚀 FIX: Instantly unlock the screen before the fade even starts!
            splash.style.pointerEvents = 'none'; 
            splash.style.opacity = '0';
            
            document.body.classList.remove('overflow-hidden');
            
            setTimeout(() => {
                splash.remove();
            }, 500); 
        }
    }, 600);
});

// ==========================================
// GLOBAL CLOUDINARY COMPRESSION ENGINE
// ==========================================
window.loadedTabs = new Set(['view-dashboard']); // Feed is loaded by default on boot

window.optimizeImageUrl = function(url, type = 'feed') {
    if (!url || !url.includes('cloudinary.com')) return url;
    if (url.includes('/upload/q_auto')) return url; 
    
    let params = 'q_auto,f_auto,w_800'; 
    if (type === 'avatar') params = 'q_auto:eco,f_auto,w_150,h_150,c_fill'; 
    // 🚀 NEW: Aggressive compression specifically for Hotpost viewer
    else if (type === 'hotpost') params = 'q_auto:low,f_auto,w_720'; 

    return url.replace('/upload/', `/upload/${params}/`);
};

// ========================================================
// BULLETPROOF PULL-TO-REFRESH ENGINE
// ========================================================
function initPullToRefresh() {
    if (window._ptrActive) return;
    window._ptrActive = true;

    // 1. DYNAMICALLY INJECT CSS & UI BUBBLE
    const style = document.createElement('style');
    style.innerHTML = `
        /* Force kill native browser overscroll completely */
        html, body { overscroll-behavior: none !important; }
        
        #smart-ptr {
            position: fixed; top: 0; left: 50%; z-index: 2147483647; /* Maximum z-index */
            transform: translate(-50%, -150px);
            display: flex; align-items: center; gap: 8px;
            background: #ffffff; padding: 10px 20px;
            border-radius: 50px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease;
            opacity: 0; pointer-events: none;
        }
        html.dark #smart-ptr { background: #1e1e1e; border: 1px solid rgba(255,255,255,0.1); }
        #smart-ptr-icon { color: #10B981; font-size: 24px; transition: transform 0.1s; }
        #smart-ptr-text { font-size: 14px; font-weight: 700; color: #000; }
        html.dark #smart-ptr-text { color: #fff; }
        .ptr-spin { animation: ptrSpin 1s linear infinite; }
        @keyframes ptrSpin { 100% { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);

    const ptrContainer = document.createElement('div');
    ptrContainer.id = 'smart-ptr';
    ptrContainer.innerHTML = `
        <span id="smart-ptr-icon" class="material-symbols-outlined">refresh</span>
        <span id="smart-ptr-text">Pull to refresh</span>
    `;
    document.body.appendChild(ptrContainer);

    const icon = document.getElementById('smart-ptr-icon');
    const text = document.getElementById('smart-ptr-text');

    let startY = 0;
    let isDragging = false;
    let isRefreshing = false;
    let lastVisualDist = 0;
    const triggerPoint = 80;

    // 2. ULTRA-SAFE TOP DETECTOR
    // This accurately climbs the DOM to ensure you are at the absolute top of the feed!
    function isAtAbsoluteTop(node) {
        let current = node;
        while (current && current !== document.body && current !== document.documentElement) {
            if (current.scrollTop > 2) return false; 
            current = current.parentNode;
        }
        if ((window.scrollY || document.documentElement.scrollTop) > 2) return false;
        return true;
    }

    document.addEventListener('touchstart', (e) => {
        if (isRefreshing) return;
        
        // Block if swiping on a modal or camera
        if (e.target.closest('[id^="modal-"]:not(.hidden), [id^="view-create-post"]:not(.hidden)')) return;

        if (isAtAbsoluteTop(e.target)) {
            startY = e.touches[0].clientY;
            isDragging = true;
            lastVisualDist = 0;
            ptrContainer.style.transition = 'none'; 
            icon.classList.remove('ptr-spin');
        }
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging || isRefreshing) return;

        const distance = e.touches[0].clientY - startY;

        if (distance < 0) {
            isDragging = false; // Cancel drag if they scroll upwards
            return;
        }

        if (distance > 0 && isAtAbsoluteTop(e.target)) {
            if (e.cancelable) e.preventDefault(); // 🛑 KILLS NATIVE BROWSER SCROLL

            lastVisualDist = distance * 0.45;
            
            ptrContainer.style.opacity = '1';
            ptrContainer.style.transform = `translate(-50%, ${Math.min(lastVisualDist, triggerPoint + 20)}px)`;
            icon.style.transform = `rotate(${lastVisualDist * 3}deg)`;

            if (lastVisualDist >= triggerPoint) {
                text.innerText = "Release to refresh";
                if (navigator.vibrate && text.dataset.vibrated !== 'true') {
                    navigator.vibrate(10);
                    text.dataset.vibrated = 'true';
                }
            } else {
                text.innerText = "Pull to refresh";
                text.dataset.vibrated = 'false';
            }
        }
    }, { passive: false }); // 🛑 MUST BE FALSE FOR PREVENT DEFAULT TO WORK

    const handleTouchEnd = async () => {
        if (!isDragging) return;
        isDragging = false;

        ptrContainer.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease';
        
        if (lastVisualDist >= triggerPoint && !isRefreshing) {
            isRefreshing = true;
            
            // Snap to loading position
            ptrContainer.style.transform = `translate(-50%, 60px)`;
            text.innerText = "Refreshing...";
            icon.style.transform = '';
            icon.classList.add('ptr-spin');

            try {
                if (window.executeContextualRefresh) await window.executeContextualRefresh();
            } catch(e) { console.error(e); }

            // Hide bubble after loading completes
            isRefreshing = false;
            ptrContainer.style.transform = `translate(-50%, -150px)`;
            ptrContainer.style.opacity = '0';
            setTimeout(() => icon.classList.remove('ptr-spin'), 300);

        } else {
            // Did not pull far enough, cancel
            ptrContainer.style.transform = `translate(-50%, -150px)`;
            ptrContainer.style.opacity = '0';
        }
        lastVisualDist = 0;
    };

    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true });
}

window.executeContextualRefresh = async function() {
    const activeTab = document.querySelector('.tab-content:not(.hidden)');
    if (!activeTab) return;

    try {
        if (activeTab.id === 'view-dashboard') {
            if (typeof window.refreshMainFeed === 'function') await window.refreshMainFeed();
            if (typeof window.refreshHotposts === 'function') await window.refreshHotposts();
        } 
        else if (activeTab.id === 'view-search') {
            if (typeof window.refreshDiscover === 'function') await window.refreshDiscover();
        }
        else if (activeTab.id === 'view-updates') {
            if (typeof window.refreshUpdates === 'function') await window.refreshUpdates();
        }
        else if (activeTab.id === 'view-profile') {
            // 🚀 FIX: Now re-fetches your entire profile (stats, bio, and posts)
            if (typeof window.refreshMyProfile === 'function') {
                await window.refreshMyProfile();
            }
        }
        await new Promise(res => setTimeout(res, 800)); // Minimum time for visual effect
    } catch (e) {
        console.error("Contextual Refresh Error:", e);
    }
};

// 🚀 NEW: Dedicated function to sync your profile data with the database natively
window.refreshMyProfile = async function() {
    if (!currentUserProfile) return;
    try {
        const { data: profile, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', currentUserProfile.id)
            .single();
        
        if (error) throw error;
        currentUserProfile = profile;
        populateProfileUI(currentUserProfile); // This automatically calls fetchMyProfileFeed internally!
    } catch (err) {
        console.error("Error refreshing profile:", err);
    }
};
// ========================================================
// IMAGE OPTIMIZATION ENGINE
// ========================================================
window.optimizeImageUrl = function(url, type = 'feed') {
    if (!url || !url.includes('cloudinary.com')) return url;
    if (url.includes('/upload/q_auto')) return url; 
    
    let params = 'q_auto,f_auto,w_800'; 
    if (type === 'avatar') params = 'q_auto:eco,f_auto,w_150,h_150,c_fill'; 
    else if (type === 'hotpost') params = 'q_auto:eco,f_auto,w_600'; 

    return url.replace('/upload/', `/upload/${params}/`);
};

// ========================================================
// CLIENT-SIDE IMAGE COMPRESSOR
// ========================================================
window.compressImage = function(file, maxSize = 800, quality = 0.8) {
    return new Promise((resolve, reject) => {
        if (!file.type.match(/image.*/)) {
            resolve(file);
            return;
        }

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = event => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxSize) {
                        height = Math.round((height *= maxSize / width));
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width = Math.round((width *= maxSize / height));
                        height = maxSize;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(blob => {
                    if (!blob) {
                        reject(new Error('Canvas compression failed'));
                        return;
                    }
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                        type: 'image/webp',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/webp', quality);
            };
            img.onerror = error => reject(error);
        };
        reader.onerror = error => reject(error);
    });
};

// ========================================================
// PROFESSIONAL SKELETON LOADERS
// ========================================================
const FEED_SKELETON = `
    <div class="bg-surface-container-lowest dark:bg-[#1e1e1e] rounded-[32px] p-5 border border-surface-variant/60 dark:border-neutral-800 shadow-sm mb-5">
        <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-full shimmer-bg shrink-0"></div>
            <div class="flex-1">
                <div class="h-3.5 shimmer-bg rounded-md w-1/3 mb-2.5"></div>
                <div class="h-2.5 shimmer-bg rounded-md w-1/4"></div>
            </div>
        </div>
        <div class="h-3 shimmer-bg rounded-md w-3/4 mb-2.5"></div>
        <div class="h-3 shimmer-bg rounded-md w-full mb-2.5"></div>
        <div class="h-3 shimmer-bg rounded-md w-5/6 mb-4"></div>
        <div class="w-full h-48 shimmer-bg rounded-2xl mb-4"></div>
        <div class="flex items-center gap-6 border-t border-surface-variant/40 dark:border-neutral-800 pt-4 mt-2">
            <div class="h-5 w-12 shimmer-bg rounded-md"></div>
            <div class="h-5 w-12 shimmer-bg rounded-md"></div>
        </div>
    </div>
`.repeat(3);

const LIST_SKELETON = `
    <div class="flex items-center gap-4 p-3 mb-3 bg-white dark:bg-neutral-900 rounded-2xl border border-gray-200 dark:border-neutral-800">
        <div class="w-12 h-12 rounded-full shimmer-bg shrink-0"></div>
        <div class="flex-1">
            <div class="h-3.5 shimmer-bg rounded-md w-1/2 mb-2.5"></div>
            <div class="h-2.5 shimmer-bg rounded-md w-1/3"></div>
        </div>
    </div>
`.repeat(5);

// ========================================================
// APP INITIALIZATION & LAYOUT
// ========================================================
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check user sessions
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = "./auth/login.html";
        return;
    }

    // 2. Fetch user profile
    const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .single();

    if (error || !profile) {
        console.error('Error fetching profile:', error);
        showToast('Could not load your profile. Please try logging in again.', 'error');
        await supabase.auth.signOut();
        window.location.replace('auth/login.html');
        return;
    }

    currentUserProfile = profile;
    initializeApp(profile);
});

function initializeApp(profile) {
    console.log('Welcome to ECampus,', profile.full_name);

    initHotposts(profile);
    initFeed(profile);
    initSearch(profile);
    initNotifications(profile);
    initUpdates();

    updateHeaderAvatar(profile.profile_img_url, profile.full_name);
    populateProfileUI(profile);
    setupMoreMenuListener();
    setupThemeToggle(); 
    setupEditProfileAvatarUpload();
    setupProfileAvatarUpload();
    document.getElementById('sign-out-btn').addEventListener('click', handleSignOut);
    setupBlockedUsersListener();

    setupAppBackButton();
    initPullToRefresh(); 

    // ------------------------------------------------------------------
    // COLD START PENDING ROUTE SYSTEM (Push Notification Deep-Linking)
    // ------------------------------------------------------------------
    const pendingRoute = localStorage.getItem('pending_notification_route');
    if (pendingRoute) {
        localStorage.removeItem('pending_notification_route');
        try {
            const routeData = JSON.parse(pendingRoute);
            
            if (routeData.type.startsWith('post_')) {
                // Keep Dashboard running in background, but slide Post View over it
                switchTab('dashboard'); 
                setTimeout(() => window.openSinglePostView(routeData.target_id), 300);
            } 
            else if (routeData.type === 'connection_accepted' || routeData.type === 'connection_request') {
                switchTab('dashboard');
                setTimeout(() => window.viewUserProfile(routeData.sender_id), 300);
            } 
            else if (routeData.type.startsWith('hotpost_')) {
                switchTab('dashboard');
                setTimeout(() => {
                    if (typeof window.showMyHotposts === 'function') window.showMyHotposts();
                    else if (typeof window.openHotpostViewer === 'function') window.openHotpostViewer(profile.id);
                }, 300);
            } else {
                switchTab('dashboard');
            }
        } catch(e) {
            console.error("Route parsing error", e);
            switchTab('dashboard');
        }
    } else {
        switchTab('dashboard'); // Normal App Boot
    }
}

async function updateNativeStatusBar(isDark) {
    try {
        if (window.Capacitor && window.Capacitor.isNativePlatform()) {
            const { StatusBar, Style } = await import('@capacitor/status-bar');
            const bgColor = isDark ? '#121212' : '#f8f9fa';
            const textStyle = isDark ? Style.Dark : Style.Light; 
            
            await StatusBar.setOverlaysWebView({ overlay: false });
            await StatusBar.setBackgroundColor({ color: bgColor });
            await StatusBar.setStyle({ style: textStyle });
        }
    } catch (error) {
        console.warn('Status bar configuration bypassed.');
    }
}

function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle-switch');
    if (!themeToggle) return;

    const isDarkMode = localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);

    document.documentElement.classList.toggle('dark', isDarkMode);
    themeToggle.checked = isDarkMode;
    updateNativeStatusBar(isDarkMode); 

    themeToggle.addEventListener('change', () => {
        if (themeToggle.checked) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
            
            // 🚀 FIX: Forcefully overwrite the boot script's background color!
            document.body.style.setProperty('background-color', '#121212', 'important');
            
            updateNativeStatusBar(true);
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('theme', 'light');
            
            // 🚀 FIX: Forcefully overwrite the boot script's background color!
            document.body.style.setProperty('background-color', '#f8f9fa', 'important');
            
            updateNativeStatusBar(false);
        }
    });
}

// 🚀 GLOBAL TICK GENERATOR (Strict Hex Engine)
window.getTickHtml = function(type) {
    if (!type || type.toLowerCase().trim() === 'none') return '';
    return `<span class="material-symbols-outlined text-[14px]" style="color: ${type.trim()}; font-variation-settings: 'FILL' 1;">verified</span>`;
};
// ========================================================
// CORE PROFILE UI & SOCIALS
// ========================================================
function setupMoreMenuListener() {
    const moreMenu = document.getElementById('public-profile-more-menu');
    const moreBtn = document.getElementById('public-profile-more-btn');

    if (moreMenu) {
        moreMenu.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            const action = button.dataset.action;
            const modal = document.getElementById('modal-profile-public');
            const userId = modal.dataset.userId;
            const userName = document.getElementById('public-profile-name').textContent;

            if (!action || !userId) return;

            moreMenu.classList.add('hidden');

            if (action === 'report') {
                openReportModal(userId, userName);
            } else {
                handleConnectionAction(userId, action, null); 
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (moreMenu && !moreMenu.classList.contains('hidden')) {
            if (moreBtn && !moreBtn.contains(e.target) && !moreMenu.contains(e.target)) {
                moreMenu.classList.add('hidden');
            }
        }
    });
}

function setupBlockedUsersListener() {
    const list = document.getElementById('blocked-users-list');
    if (!list) return;

    list.addEventListener('click', async (e) => {
        const unblockBtn = e.target.closest('.unblock-btn');
        if (unblockBtn && !unblockBtn.disabled) {
            const userIdToUnblock = unblockBtn.dataset.userId;
            unblockBtn.disabled = true;
            unblockBtn.textContent = '...';
            await handleConnectionAction(userIdToUnblock, 'unblock', null);
            openBlockedUsersModal(); 
        }
    });
}

const socialIconMap = {
    linkedin: { icon: 'fa-brands fa-linkedin-in', color: 'bg-[#0A66C2]' },
    instagram: { icon: 'fa-brands fa-instagram', color: 'bg-gradient-to-br from-purple-400 via-pink-500 to-red-500' },
    github: { icon: 'fa-brands fa-github', color: 'bg-[#181717] dark:bg-white dark:!text-black' },
    twitter: { icon: 'fa-brands fa-x-twitter', color: 'bg-[#000000] dark:bg-white dark:!text-black' },
    youtube: { icon: 'fa-brands fa-youtube', color: 'bg-[#FF0000]' },
    discord: { icon: 'fa-brands fa-discord', color: 'bg-[#5865F2]' },
    facebook: { icon: 'fa-brands fa-facebook-f', color: 'bg-[#1877F2]' },
    whatsapp: { icon: 'fa-brands fa-whatsapp', color: 'bg-[#25D366]' },
    snapchat: { icon: 'fa-brands fa-snapchat', color: 'bg-[#FFFC00] !text-black' }, 
    telegram: { icon: 'fa-brands fa-telegram', color: 'bg-[#229ED9]' },
    spotify: { icon: 'fa-brands fa-spotify', color: 'bg-[#1DB954]' },
    reddit: { icon: 'fa-brands fa-reddit-alien', color: 'bg-[#FF4500]' },
    website: { icon: 'fa-solid fa-globe', color: 'bg-primary' }, 
    other: { icon: 'fa-solid fa-link', color: 'bg-gray-500' }
};

function renderSocialLinks(links, container = null) {
    const targetContainer = container || document.getElementById('profile-social-links');
    if (!targetContainer) return;

    targetContainer.innerHTML = ''; 

    if (links && links.length > 0) {
        links.forEach(link => {
            const platformInfo = socialIconMap[link.platform] || socialIconMap['other'];
            const linkEl = document.createElement('a');
            linkEl.href = link.url;
            linkEl.target = '_blank';
            linkEl.title = link.platform.charAt(0).toUpperCase() + link.platform.slice(1);
            linkEl.className = `w-[52px] h-[52px] rounded-2xl flex items-center justify-center text-white text-2xl ${platformInfo.color} transition-transform hover:scale-110 shrink-0 shadow-sm`;
            linkEl.innerHTML = `<i class="${platformInfo.icon}"></i>`;
            targetContainer.appendChild(linkEl);
        });
    }

    if (!container) {
        const addButton = document.createElement('button');
        addButton.onclick = () => openEditSocialsModal();
        addButton.className = 'w-[52px] h-[52px] rounded-2xl flex items-center justify-center bg-gray-100 dark:bg-neutral-800 border-2 border-dashed border-gray-300 dark:border-neutral-700 text-gray-400 dark:text-gray-500 hover:border-primary hover:text-primary transition-colors shrink-0';
        addButton.innerHTML = `<span class="material-symbols-outlined">add</span>`;
        targetContainer.appendChild(addButton);
    }
}

function populateProfileUI(profile) {
    if (!profile) return;
    
    const headerNameEl = document.getElementById('my-profile-header-name');
    if (headerNameEl) headerNameEl.textContent = profile.full_name;
    
    const tickEl = document.getElementById('my-profile-header-tick');
    if (tickEl) {
        if (profile.tick_type && profile.tick_type.toLowerCase().trim() !== 'none') {
            tickEl.className = `material-symbols-outlined text-[18px]`;
            tickEl.style.color = profile.tick_type.trim();
            tickEl.style.fontVariationSettings = "'FILL' 1";
            tickEl.classList.remove('hidden');
        } else {
            tickEl.classList.add('hidden');
            tickEl.style.color = '';
        }
    }
    
    const avatarEl = document.getElementById('my-profile-avatar');
    if (avatarEl) avatarEl.src = profile.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.full_name)}&background=e1e3e4`;
    
    const connCountEl = document.getElementById('my-profile-connection-count');
    if (connCountEl) {
        connCountEl.textContent = profile.connection_count || 0;
        // Dynamically change label based on role
        if (profile.role === 'page') {
            connCountEl.nextElementSibling.textContent = 'Followers';
            const sidebarText = document.getElementById('sidebar-stats-text');
            if (sidebarText) sidebarText.textContent = 'Followers';
        } else {
            connCountEl.nextElementSibling.textContent = 'Connections';
            const sidebarText = document.getElementById('sidebar-stats-text');
            if (sidebarText) sidebarText.textContent = 'Connections';
        }
    }
    
    const courseEl = document.getElementById('my-profile-course');
    if (courseEl) courseEl.textContent = profile.role === 'page' ? 'Official Page' : (profile.course || 'Student');
    
    const bioEl = document.getElementById('my-profile-bio');
    if (bioEl) bioEl.textContent = profile.bio || 'No bio yet. Click "Edit Profile" to add one!';
    
    const feedInputAvatar = document.getElementById('feed-input-avatar');
    if (feedInputAvatar) feedInputAvatar.src = profile.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.full_name)}&background=e1e3e4`;
    
    renderSocialLinks(profile.social_links, document.getElementById('my-profile-social-links'));
    const privacyToggle = document.getElementById('privacy-toggle-switch');
    if (privacyToggle) privacyToggle.checked = profile.is_private || false;

    if (typeof fetchMyProfileFeed === 'function') {
        fetchMyProfileFeed(profile.id);
    }
    // Sync Mention Privacy Select
    const mentionPrivacySelect = document.getElementById('mention-privacy-select');
    if (mentionPrivacySelect) mentionPrivacySelect.value = profile.mention_privacy || 'connections';
}

// ========================================================
// PROFILE FEED RENDER ENGINE
// ========================================================
window.fetchMyProfileFeed = async function(userId) {
    const feedContainer = document.getElementById('my-profile-feed');
    if(!feedContainer) return;

    feedContainer.innerHTML = FEED_SKELETON; 
    
    try {
        const { data: posts, error } = await supabase
            .from('posts')
            .select(`
                *,
                users ( id, full_name, profile_img_url, role, tick_type ),
                post_likes ( user_id ),
                post_comments ( count ),
                post_poll_votes ( user_id, option_id ) /* <-- FIXED HERE */
            `)
            .eq('user_id', userId)
            .eq('is_deleted', false)
            .order('created_at', { ascending: false });
        
        if (error) throw error;

        const countEl = document.getElementById('my-profile-posts-count');
        if (countEl) countEl.textContent = posts.length;

        if (posts.length === 0) {
            feedContainer.innerHTML = `
                <div class="py-12 flex flex-col items-center justify-center opacity-40 text-on-surface-variant">
                    <span class="material-symbols-outlined text-[42px] mb-2">menu_book</span>
                    <p class="text-sm font-medium">No posts yet</p>
                </div>`;
            return;
        }

        feedContainer.innerHTML = generatePostHTML(posts, currentUserProfile.id);

    } catch (err) {
        console.error("Error fetching my feed:", err);
        feedContainer.innerHTML = `<p class="text-xs text-center py-4 text-error">Failed to load posts.</p>`;
    }
}

function generatePostHTML(posts, currentUserId) {
    return posts.map(post => {
        const user = post.users;
        if (!user) return '';

        const likes = post.post_likes || [];
        const likeCount = likes.length;
        const userHasLiked = likes.some(like => like.user_id === currentUserId);
        
        let likedByHtml = '';
        if (likeCount > 0) {
            const featuredLiker = likes.find(l => l.user_id !== currentUserId)?.users?.full_name || likes[0]?.users?.full_name || 'Someone';
            if (likeCount === 1) {
                likedByHtml = `Liked by <span class="font-bold text-on-surface dark:text-gray-100">${featuredLiker}</span>`;
            } else {
                likedByHtml = `Liked by <span class="font-bold text-on-surface dark:text-gray-100">${featuredLiker}</span> and <span onclick="window.openLikesModal('${post.id}')" class="font-bold text-on-surface dark:text-gray-100 cursor-pointer">others</span>`;
            }
        }

        const comments = post.post_comments || [];
        const commentCount = comments.length;
        let commentsHtml = '';
        if (commentCount > 0) {
            const previewCount = commentCount > 1 ? `View all ${commentCount} comments` : 'View 1 comment';
            commentsHtml = `<p data-post-id="${post.id}" class="comment-btn text-[14px] text-on-surface-variant dark:text-gray-400 mt-1 cursor-pointer active:opacity-70">${previewCount}</p>`;
            
            const latestComment = comments[comments.length - 1];
            if (latestComment) {
                const cleanComment = latestComment.content.replace(/<[^>]*>?/gm, '');
                commentsHtml += `<p class="text-[14px] text-on-surface dark:text-gray-100 mt-1 leading-snug"><span class="font-bold mr-1 cursor-pointer">${latestComment.users?.full_name || 'User'}</span><span class="text-on-surface-variant dark:text-gray-300">${cleanComment}</span></p>`;
            }
        }

        const verifiedBadge = typeof getTickHtmlLocal === 'function' ? getTickHtmlLocal(user.tick_type) : '';
        const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
        const optimizedAvatar = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
        const headerIcon = `<img loading="lazy" onclick="window.openPublicProfile('${user.id}')" src="${optimizedAvatar}" data-user-id="${user.id}" class="profile-link w-8 h-8 rounded-full border border-surface-variant shadow-sm object-cover cursor-pointer hover:opacity-80 transition-opacity shrink-0">`;

        let cleanCaptionContent = '';
        if (post.content && post.content.trim() !== '' && post.content !== '<p><br></p>') {
            cleanCaptionContent = post.content.replace(/^<p>/, '').replace(/<\/p>$/, '').trim();
        }

        let contentHtml = '';
        
        if (post.post_type === 'text') {
            if (cleanCaptionContent !== '') {
                contentHtml = `
                    <div class="px-4 py-8 mt-2 mb-2 bg-surface-variant/10 dark:bg-neutral-900/40 rounded-2xl mx-3 flex items-center justify-center border border-surface-variant/30 dark:border-neutral-800">
                        <div class="text-[16px] sm:text-[18px] font-medium text-on-surface dark:text-gray-100 leading-relaxed whitespace-pre-wrap rich-text-content text-center w-full">${post.content}</div>
                    </div>
                `;
            }
            cleanCaptionContent = ''; 
        }
        else if (post.post_type === 'image') {
            const optimizedMedia = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(post.media_url, 'feed') : post.media_url;
            contentHtml = `
                <div class="w-full bg-surface-variant/20 dark:bg-neutral-900 flex items-center justify-center border-y border-surface-variant/40 dark:border-neutral-800 mt-2">
                    <img loading="lazy" src="${optimizedMedia}" class="w-full h-auto max-h-[80vh] object-cover">
                </div>
            `;
        }
        else if (post.post_type === 'event') {
            const optimizedEventMedia = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(post.event_image_url, 'feed') : post.event_image_url;
            const eventImgHtml = post.event_image_url ? `<img loading="lazy" src="${optimizedEventMedia}" class="w-full h-auto max-h-[60vh] object-cover border-y border-surface-variant/40 dark:border-neutral-800 mt-2">` : '';
            const btnText = post.event_button_text || 'View Link';
            const registerHtml = post.event_register_url ? `<a href="${post.event_register_url}" target="_blank" class="block w-full mt-3 bg-secondary text-white text-center py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-transform">View Link</a>` : '';
            const dateStr = post.event_date ? new Date(post.event_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA';

            contentHtml = `
                ${eventImgHtml}
                <div class="px-3 py-3 bg-secondary/5 border-b border-secondary/20 dark:border-neutral-800">
                    <div class="bg-secondary/10 text-secondary w-max px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest mb-2">Upcoming Event</div>
                    <div class="space-y-1">
                        <p class="text-[13px] text-on-surface-variant dark:text-gray-300 flex items-center gap-2 font-medium">
                            <span class="material-symbols-outlined text-[16px]">calendar_today</span> ${dateStr}
                        </p>
                        ${post.event_location ? `<p class="text-[13px] text-on-surface-variant dark:text-gray-300 flex items-center gap-2 font-medium"><span class="material-symbols-outlined text-[16px]">location_on</span> ${post.event_location}</p>` : ''}
                    </div>
                    ${registerHtml}
                </div>
            `;
        }
        else if (post.post_type === 'poll') {
            const votes = post.post_poll_votes || [];
            const totalVotes = votes.length;
            const myVotes = votes.filter(v => v.user_id === currentUserId).map(v => v.option_index); 
            const userHasVoted = myVotes.length > 0;
            
            const isExpired = post.poll_expires_at && new Date(post.poll_expires_at) < new Date();
            const showResults = userHasVoted || isExpired || post.poll_is_anon;

            const optionsHtml = (post.poll_options || []).map((opt, index) => {
                const optVotes = votes.filter(v => v.option_index === index).length;
                const percentage = totalVotes === 0 ? 0 : Math.round((optVotes / totalVotes) * 100);
                const iVotedForThis = myVotes.includes(index);
                
                return `
                <div class="poll-option-btn cursor-default relative w-full bg-surface-variant/30 dark:bg-surface-variant/10 border border-surface-variant/50 dark:border-neutral-700 rounded-xl p-3 overflow-hidden transition-all mb-2">
                    <div class="poll-progress-bar absolute left-0 top-0 bottom-0 bg-primary/20 rounded-r-xl transition-all duration-700 ease-out" style="width: ${showResults ? percentage : 0}%"></div>
                    <div class="relative flex justify-between items-center text-[13px] font-bold text-on-surface dark:text-gray-100 z-10">
                        <span class="flex items-center gap-2">
                            <span class="poll-check-circle w-4 h-4 rounded-full border-2 ${iVotedForThis ? 'border-primary flex items-center justify-center' : 'border-surface-variant/80'}">
                                ${iVotedForThis ? '<span class="w-2 h-2 rounded-full bg-primary"></span>' : ''}
                            </span>
                            ${opt}
                        </span>
                        <span class="poll-percentage ${showResults ? 'opacity-100' : 'opacity-0'} transition-opacity">${percentage}%</span>
                    </div>
                </div>`;
            }).join('');

            contentHtml = `
                <div class="px-3 py-3 border-y border-surface-variant/40 dark:border-neutral-800 bg-surface-variant/5 dark:bg-neutral-900/30 mt-2">
                    <div class="poll-options-wrapper space-y-2 mb-2">${optionsHtml}</div>
                    <div class="flex justify-between text-[11px] font-medium text-on-surface-variant dark:text-gray-400">
                        <span><span class="poll-total-votes">${totalVotes}</span> votes</span>
                        <span>${isExpired ? 'Ended' : 'Ongoing'}</span>
                    </div>
                </div>
            `;
        }

        let captionHtml = '';
        if (cleanCaptionContent !== '') {
            captionHtml = `
            <div class="px-3 text-[14px] text-on-surface dark:text-gray-100 leading-snug mt-1">
                <span data-user-id="${user.id}" class="profile-link font-bold mr-1 cursor-pointer hover:underline">${user.full_name}</span>
                <span class="rich-text-content inline">${cleanCaptionContent}</span>
            </div>`;
        }

        return `
        <div data-post-id="${post.id}" class="bg-surface dark:bg-[#121212] mb-6 animate-fadeIn pb-4 border-b border-surface-variant/40 dark:border-neutral-800 relative">
            
            ${post.is_verified ? '<div class="absolute top-3 right-3 bg-[#e8b339] text-white px-2 py-0.5 rounded text-[9px] font-extrabold uppercase shadow-sm z-10"><span class="material-symbols-outlined text-[12px] align-middle">stars</span> Verified</div>' : ''}

            <div class="flex items-center gap-3 px-3 py-2">
                ${headerIcon}
                <div class="flex-1 min-w-0">
                    <h4 onclick="window.openPublicProfile('${user.id}')" class="font-bold text-[14px] cursor-pointer hover:text-primary transition-colors flex items-center gap-1 truncate">
                        ${user.full_name} ${verifiedBadge}
                    </h4>
                    ${post.post_events && post.post_events.length > 0 && post.post_events[0].event_location ? `<p class="text-[11px] text-on-surface-variant dark:text-gray-400 mt-0.5 truncate">${post.post_events[0].event_location}</p>` : ''}
                </div>
                <button data-post-id="${post.id}" data-user-id="${user.id}" data-is-verified="${post.is_verified}" class="post-options-btn text-on-surface dark:text-gray-100 p-1.5 active:opacity-60 transition-opacity">
                    <span class="material-symbols-outlined text-[20px]">more_vert</span>
                </button>
            </div>
            
            ${contentHtml}
            
            <div class="flex items-center justify-between px-3 pt-2 pb-1 mt-1">
                <div class="flex items-center gap-4">
                    <button onclick="window.handleLike('${post.id}', this)" data-post-id="${post.id}" data-liked="${userHasLiked}" class="like-btn flex items-center justify-center transition-transform active:scale-90 ${userHasLiked ? 'text-red-500' : 'text-on-surface dark:text-gray-100 hover:text-on-surface-variant'}">
                        <span class="material-symbols-outlined text-[26px]" style="font-variation-settings: 'FILL' ${userHasLiked ? 1 : 0};">favorite</span> 
                    </button>
                    <button data-post-id="${post.id}" class="comment-btn flex items-center justify-center text-on-surface dark:text-gray-100 transition-transform active:scale-90 hover:text-on-surface-variant">
                        <span class="material-symbols-outlined text-[24px]" style="transform: scaleX(-1);">chat_bubble_outline</span> 
                    </button>
                    <button class="flex items-center justify-center text-on-surface dark:text-gray-100 transition-transform active:scale-90 hover:text-on-surface-variant">
                        <span class="material-symbols-outlined text-[24px] -rotate-45 -mt-1">send</span> 
                    </button>
                </div>
                <button class="flex items-center justify-center text-on-surface dark:text-gray-100 transition-transform active:scale-90 hover:text-on-surface-variant">
                    <span class="material-symbols-outlined text-[26px]">bookmark_border</span>
                </button>
            </div>
            
            ${likeCount > 0 ? `<div class="px-3 mb-1 text-[14px] text-on-surface dark:text-gray-100">${likedByHtml}</div>` : ''}
            ${captionHtml}
            
            <div class="px-3 mt-1">
                ${commentsHtml}
            </div>

            <div class="px-3 mt-2 flex items-center gap-2">
                <img src="${currentUserProfile?.profile_img_url || 'https://ui-avatars.com/api/?name=User'}" class="w-6 h-6 rounded-full object-cover border border-surface-variant/50 shrink-0">
                <p data-post-id="${post.id}" class="comment-btn flex-1 text-[13px] text-on-surface-variant dark:text-gray-500 cursor-text">Add a comment...</p>
            </div>

            <p class="px-3 text-[11px] text-on-surface-variant dark:text-gray-500 mt-2 uppercase tracking-wide">${timeAgo(post.created_at)}</p>
        </div>
        `;
    }).join('');
}
// ========================================================
// SIDEBAR & SETTINGS
// ========================================================
window.openSettingsSidebar = function() {
    const sidebar = document.getElementById('settings-sidebar');
    const content = document.getElementById('settings-main-panel'); // Fixed ID
    const bottomNav = document.querySelector('nav'); 
    
    sidebar.classList.remove('hidden');
    sidebar.classList.add('flex');
    if (bottomNav) bottomNav.classList.add('hidden');
    
    void sidebar.offsetWidth;
    sidebar.classList.remove('opacity-0');
    content.classList.remove('translate-x-full');
};

window.closeSettingsSidebar = function() {
    const sidebar = document.getElementById('settings-sidebar');
    const content = document.getElementById('settings-main-panel'); // Fixed ID
    const bottomNav = document.querySelector('nav');
    
    sidebar.classList.add('opacity-0');
    content.classList.add('translate-x-full');
    
    // Also close any open sub-panels so it resets for next time
    const subPanels = document.querySelectorAll('[id^="settings-"][id$="-panel"]');
    subPanels.forEach(panel => {
        if (panel.id !== 'settings-main-panel') panel.classList.add('translate-x-full');
    });

    setTimeout(() => {
        sidebar.classList.remove('flex');
        sidebar.classList.add('hidden');
        if (bottomNav) bottomNav.classList.remove('hidden');
    }, 300);
};
async function togglePrivacy(isPrivate) {
    try {
        const { error } = await supabase.from('users').update({ is_private: isPrivate }).eq('id', currentUserProfile.id);
        if (error) throw error;
        currentUserProfile.is_private = isPrivate;
        showToast(isPrivate ? 'Account is now Private' : 'Account is now Public', 'success');
    } catch (err) {
        console.error("Privacy toggle error:", err);
        showToast('Failed to update privacy settings', 'error');
        document.getElementById('privacy-toggle-switch').checked = !isPrivate;
    }
}

function shareMyProfile() {
    if (navigator.share) {
        navigator.share({
            title: `${currentUserProfile.full_name}'s Profile`,
            text: `Check out my ECampus profile!`,
            url: window.location.href
        }).catch(console.error);
    } else {
        showToast('Profile link copied to clipboard!', 'success');
    }
}

window.openSettingsSidebar = openSettingsSidebar;
window.closeSettingsSidebar = closeSettingsSidebar;
window.togglePrivacy = togglePrivacy;
window.shareMyProfile = shareMyProfile;

function updateHeaderAvatar(avatarUrl, fullName) {
    const avatarImg = document.getElementById('header-avatar');
    if (avatarImg) avatarImg.src = avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=e1e3e4`;
}

// ========================================================
// UPLOADS & USER ACTIONS 
// ========================================================

function setupEditProfileAvatarUpload() {
    const avatarInput = document.getElementById('edit-avatar-upload-input');
    if (!avatarInput) return;

    avatarInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const preview = document.getElementById('edit-profile-avatar-preview');
        const mainProfileAvatar = document.getElementById('my-profile-avatar');
        const originalSrc = preview.src;

        const tempUrl = URL.createObjectURL(file);
        preview.src = tempUrl;
        preview.style.opacity = '0.5';
        preview.style.filter = 'blur(3px)';
        preview.style.transition = 'all 0.3s ease';
        if (mainProfileAvatar) mainProfileAvatar.src = tempUrl;

        try {
            const formData = new FormData();
            const fileToUpload = typeof compressImage === 'function' ? await compressImage(file, 500, 0.8) : file;
            formData.append('file', fileToUpload);
            formData.append('upload_preset', CLOUDINARY_AVATARS_PRESET);

            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);

            await saveUserProfile({ profile_img_url: data.secure_url }, false);

            preview.src = data.secure_url;
            preview.style.opacity = '1';
            preview.style.filter = 'blur(0px)';
            if (mainProfileAvatar) mainProfileAvatar.src = data.secure_url;
            updateHeaderAvatar(data.secure_url, currentUserProfile.full_name);

            showToast('Profile picture updated!', 'success');

        } catch (error) {
            console.error('Error updating avatar:', error);
            showToast('Failed to update avatar.', 'error');
            preview.src = originalSrc; 
            preview.style.opacity = '1';
            preview.style.filter = 'blur(0px)';
            if (mainProfileAvatar) mainProfileAvatar.src = originalSrc;
        } finally {
            avatarInput.value = '';
        }
    });
}

function setupProfileAvatarUpload() {
    const avatarInput = document.getElementById('avatar-upload-input');
    if (!avatarInput) return;

    avatarInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const preview = document.getElementById('my-profile-avatar');
        const editPreview = document.getElementById('edit-profile-avatar-preview');
        const originalSrc = preview.src;

        const tempUrl = URL.createObjectURL(file);
        preview.src = tempUrl;
        preview.style.opacity = '0.5';
        preview.style.filter = 'blur(3px)';
        preview.style.transition = 'all 0.3s ease';
        if (editPreview) editPreview.src = tempUrl;

        try {
            const formData = new FormData();
           const fileToUpload = typeof compressImage === 'function' ? await compressImage(file, 500, 0.8) : file;
            formData.append('file', fileToUpload);
            formData.append('upload_preset', CLOUDINARY_AVATARS_PRESET);

            const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: formData });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);

            const { error } = await supabase.from('users').update({ profile_img_url: data.secure_url }).eq('id', currentUserProfile.id);
            if (error) throw error;

            currentUserProfile.profile_img_url = data.secure_url;

            preview.src = data.secure_url;
            preview.style.opacity = '1';
            preview.style.filter = 'blur(0px)';
            if (editPreview) editPreview.src = data.secure_url;
            updateHeaderAvatar(data.secure_url, currentUserProfile.full_name);

            showToast('Avatar updated successfully!', 'success');
        } catch (error) {
            console.error('Error updating avatar:', error);
            showToast('Failed to update avatar. Please try again.', 'error');
            preview.src = originalSrc;
            preview.style.opacity = '1';
            preview.style.filter = 'blur(0px)';
            if (editPreview) editPreview.src = originalSrc;
        } finally {
            avatarInput.value = ''; 
        }
    });
}

async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.replace('auth/login.html');
}

window.switchTab = switchTab;
window.openProfileModal = openProfileModal;
window.closeProfileModals = closeProfileModals;

let tempSocialLinks = [];

window.openEditProfileModal = function() {
    if (!currentUserProfile) return;

    document.getElementById('edit-profile-name').value = currentUserProfile.full_name || '';
    document.getElementById('edit-profile-id').value = currentUserProfile.student_id || '';
    document.getElementById('edit-profile-course').value = currentUserProfile.course || '';
    document.getElementById('edit-profile-bio').value = currentUserProfile.bio || '';
    document.getElementById('edit-profile-avatar-preview').src = currentUserProfile.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUserProfile.full_name)}&background=e1e3e4`;

    const modal = document.getElementById('modal-edit-profile');
    const bottomNav = document.querySelector('nav');

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (bottomNav) bottomNav.classList.add('hidden'); 

    setTimeout(() => {
        modal.classList.remove('translate-x-full');
    }, 10);
};

window.closeEditProfileModal = function() {
    const modal = document.getElementById('modal-edit-profile');
    const bottomNav = document.querySelector('nav');

    modal.classList.add('translate-x-full');

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (bottomNav) bottomNav.classList.remove('hidden'); 
    }, 300);
};

window.triggerEditAvatarUpload = function() {
    document.getElementById('edit-avatar-upload-input').click();
};

window.saveUserProfile = async function(extraUpdates = {}, closeModal = true) {
    const btn = document.getElementById('save-profile-btn');
    if (closeModal && btn) {
        btn.disabled = true;
        btn.innerHTML = 'Saving...';
    }

    const updates = {
        full_name: document.getElementById('edit-profile-name').value.trim(),
        student_id: document.getElementById('edit-profile-id').value.trim(),
        course: document.getElementById('edit-profile-course').value.trim(),
        bio: document.getElementById('edit-profile-bio').value.trim(),
        ...extraUpdates
    };

    try {
        const { data, error } = await supabase.from('users').update(updates).eq('id', currentUserProfile.id).select().single();
        if (error) throw error;

        currentUserProfile = data;
        populateProfileUI(currentUserProfile);
        updateHeaderAvatar(currentUserProfile.profile_img_url, currentUserProfile.full_name);

        if (closeModal) {
            showToast('Profile updated!', 'success');
            closeEditProfileModal();
        }

    } catch (error) {
        console.error('Error saving profile:', error);
        showToast('Failed to save profile.', 'error');
    } finally {
        if (closeModal && btn) {
            btn.disabled = false;
            btn.innerHTML = 'Save';
        }
    }
};
// ========================================================
// SOCIAL LINKS EDITOR (Native Full-Screen Engine)
// ========================================================
function openEditSocialsModal() {
    if (!currentUserProfile) return;
    
    let links = currentUserProfile.social_links;
    if (typeof links === 'string') {
        try { links = JSON.parse(links); } catch(e) { links = []; }
    }
    tempSocialLinks = Array.isArray(links) ? JSON.parse(JSON.stringify(links)) : [];
    
    renderTempSocialsList();
    
    const modal = document.getElementById('modal-edit-socials');
    const bottomNav = document.querySelector('nav');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (bottomNav) bottomNav.classList.add('hidden');
    
    setTimeout(() => {
        modal.classList.remove('translate-x-full');
    }, 10);
}

function closeSocialsModal() {
    const modal = document.getElementById('modal-edit-socials');
    const bottomNav = document.querySelector('nav');
    
    modal.classList.add('translate-x-full');
    
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (bottomNav) bottomNav.classList.remove('hidden');
    }, 300);
}

function renderTempSocialsList() {
    const list = document.getElementById('modal-socials-list');
    list.innerHTML = '';
    
    if (!Array.isArray(tempSocialLinks) || tempSocialLinks.length === 0) {
        list.innerHTML = `
            <div class="py-10 flex flex-col items-center justify-center opacity-40 text-on-surface-variant">
                <span class="material-symbols-outlined text-[42px] mb-2">link_off</span>
                <p class="text-sm font-medium">No links added yet.</p>
            </div>`;
        return;
    }

    const platformStyles = {
        linkedin: { icon: 'fa-brands fa-linkedin-in', color: 'text-[#0A66C2]' },
        instagram: { icon: 'fa-brands fa-instagram', color: 'text-pink-500' },
        github: { icon: 'fa-brands fa-github', color: 'text-on-surface dark:text-white' },
        twitter: { icon: 'fa-brands fa-x-twitter', color: 'text-on-surface dark:text-white' },
        youtube: { icon: 'fa-brands fa-youtube', color: 'text-[#FF0000]' },
        discord: { icon: 'fa-brands fa-discord', color: 'text-[#5865F2]' },
        whatsapp: { icon: 'fa-brands fa-whatsapp', color: 'text-[#25D366]' },
        snapchat: { icon: 'fa-brands fa-snapchat', color: 'text-[#FFFC00] drop-shadow-sm' },
        telegram: { icon: 'fa-brands fa-telegram', color: 'text-[#229ED9]' },
        spotify: { icon: 'fa-brands fa-spotify', color: 'text-[#1DB954]' },
        reddit: { icon: 'fa-brands fa-reddit-alien', color: 'text-[#FF4500]' },
        website: { icon: 'fa-solid fa-globe', color: 'text-primary' }
    };

    tempSocialLinks.forEach((link, index) => {
        const style = platformStyles[link.platform] || { icon: 'fa-solid fa-link', color: 'text-gray-500' };
        
        list.innerHTML += `
            <div class="flex items-center gap-3 bg-surface-container-lowest dark:bg-[#1e1e1e] p-3.5 rounded-2xl border border-surface-variant/50 dark:border-neutral-800 shadow-sm animate-fadeIn">
                <div class="w-10 h-10 rounded-full bg-surface-variant/30 dark:bg-neutral-800 flex items-center justify-center ${style.color} shrink-0">
                    <i class="${style.icon} text-[18px]"></i>
                </div>
                <div class="flex-1 min-w-0">
                    <p class="font-extrabold text-[13px] text-on-surface dark:text-gray-100 uppercase tracking-wide">${link.platform}</p>
                    <p class="text-[12px] text-on-surface-variant dark:text-gray-400 truncate mt-0.5">${link.url}</p>
                </div>
                <button onclick="removeSocialLinkTemp(${index})" class="w-8 h-8 rounded-full bg-error/10 text-error flex items-center justify-center active:scale-95 transition-transform shrink-0">
                    <span class="material-symbols-outlined text-[18px]">delete</span>
                </button>
            </div>
        `;
    });
}

function addSocialLinkTemp() {
    const platformId = document.getElementById('add-social-platform').value;
    let val = document.getElementById('add-social-url').value.trim();
    
    if (!val) {
        showToast('Please enter your username, number, or link.', 'warning');
        return;
    }

    const config = socialPlatformsConfig[platformId];
    let finalUrl = val;

    if (!val.startsWith('http://') && !val.startsWith('https://')) {
        if (val.startsWith('@') && platformId !== 'youtube') {
            val = val.substring(1);
        }
        if (platformId === 'youtube' && !val.startsWith('@') && !val.includes('/')) {
            val = '@' + val;
        }
        finalUrl = config.prefix + val;
    }

    const existingLinkIndex = tempSocialLinks.findIndex(link => link.platform === platformId);
    if (existingLinkIndex > -1) {
        tempSocialLinks[existingLinkIndex].url = finalUrl;
    } else {
        tempSocialLinks.push({ platform: platformId, url: finalUrl });
    }
    
    renderTempSocialsList();
    document.getElementById('add-social-url').value = '';
}

function removeSocialLinkTemp(index) {
    tempSocialLinks.splice(index, 1);
    renderTempSocialsList();
}

async function saveSocialLinks() {
    const { error } = await supabase.from('users').update({ social_links: tempSocialLinks }).eq('id', currentUserProfile.id);

    if (error) {
        showToast('Failed to save social links.', 'error');
        console.error('Error saving social links:', error);
    } else {
        currentUserProfile.social_links = tempSocialLinks;
        populateProfileUI(currentUserProfile);
        showToast('Social links updated!', 'success');
        closeSocialsModal();
    }
}

window.openEditProfileModal = openEditProfileModal;
window.closeEditProfileModal = closeEditProfileModal;
window.triggerEditAvatarUpload = triggerEditAvatarUpload;
window.saveUserProfile = saveUserProfile;
window.openEditSocialsModal = openEditSocialsModal;
window.closeSocialsModal = closeSocialsModal;
window.addSocialLinkTemp = addSocialLinkTemp;
window.removeSocialLinkTemp = removeSocialLinkTemp;
window.saveSocialLinks = saveSocialLinks;

// ========================================================
// PUBLIC/PRIVATE PROFILE VIEWS 
// ========================================================
async function viewUserProfile(userId) {
    if (window.isLongPressing) return; 

    const moreMenu = document.getElementById('public-profile-more-menu');
    if (moreMenu) moreMenu.classList.add('hidden');

    if (userId === currentUserProfile.id) {
        switchTab('profile');
        return;
    }

    // --- 1. INSTANT UI FEEDBACK (SHIMMER) ---
    document.getElementById('modal-profile-public').dataset.userId = userId;
    
    // Header & Avatar
    document.getElementById('public-profile-header-name').innerHTML = `<div class="w-24 h-4 rounded-md shimmer-bg"></div>`;
    const avatarEl = document.getElementById('public-profile-avatar');
    avatarEl.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='; // Transparent placeholder
    avatarEl.parentElement.classList.add('shimmer-bg');
    
    // Details
    document.getElementById('public-profile-name').innerHTML = `<div class="w-32 h-6 rounded-md shimmer-bg mx-auto"></div>`;
    document.getElementById('public-profile-course').innerHTML = `<div class="w-20 h-4 rounded-md shimmer-bg mx-auto"></div>`;
    document.getElementById('public-profile-connection-count').parentElement.innerHTML = `<span id="public-profile-connection-count" class="font-bold">-</span>`;
    document.getElementById('public-profile-bio').innerHTML = `<div class="flex flex-col gap-1.5 items-center"><div class="w-48 h-3 rounded-md shimmer-bg"></div><div class="w-32 h-3 rounded-md shimmer-bg"></div></div>`;
    document.getElementById('public-profile-social-links').innerHTML = '';
    
    // Actions & Feed
    document.getElementById('public-profile-actions').innerHTML = `<div class="w-full h-11 rounded-xl shimmer-bg"></div>`;
    document.getElementById('public-profile-feed').innerHTML = FEED_SKELETON;

    // Slide up instantly!
    openProfileModal('public');

    // --- 2. NOW FETCH DATA ---
    const { data: user, error } = await supabase.from('users').select('*').eq('id', userId).single();
    if (error || !user) {
        showToast('Could not load profile.', 'error');
        closeProfileModals();
        return;
    }

    let connection = null;
    let followRecord = null;

    if (user.role === 'page') {
        const { data: fData, error: fError } = await supabase
            .from('page_followers').select('*').eq('page_id', user.id).eq('follower_id', currentUserProfile.id).maybeSingle();
        followRecord = fData;
    } else {
        const { data: cData } = await supabase
            .from('connections').select('status, action_user_id')
            .or(`and(user_one_id.eq.${currentUserProfile.id},user_two_id.eq.${user.id}),and(user_one_id.eq.${user.id},user_two_id.eq.${currentUserProfile.id})`).maybeSingle();
        connection = cData;
    }

    const isConnected = connection?.status === 'accepted';
    const getTickHtmlLocal = (tickType) => {
        if (!tickType || tickType.toLowerCase().trim() === 'none') return '';
        return `<span class="material-symbols-outlined text-[14px]" style="color: ${tickType.trim()}; font-variation-settings: 'FILL' 1;">verified</span>`;
    };

    // Remove Avatar Shimmer
    avatarEl.parentElement.classList.remove('shimmer-bg');
    
    // Populate Top Meta Data
    document.getElementById('public-profile-header-name').innerHTML = `<span class="flex items-center gap-1">${user.full_name} ${getTickHtmlLocal(user.tick_type)}</span>`;
    avatarEl.src = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
    document.getElementById('public-profile-name').innerHTML = `<span class="flex items-center justify-center gap-1">${user.full_name} ${getTickHtmlLocal(user.tick_type)}</span>`;

    // --- Handle PRIVATE Profile directly in the same UI container ---
    if (user.is_private && !isConnected && user.role !== 'page') {
        document.getElementById('public-profile-course').textContent = user.course || 'Student';
        
        // Disable Click & Route
        const statsContainer = document.getElementById('public-profile-connection-count').parentElement;
        statsContainer.innerHTML = `<span id="public-profile-connection-count" class="font-bold text-on-surface dark:text-gray-200">Private</span> account`;
        statsContainer.className = "text-sm text-on-surface-variant dark:text-gray-400 mb-4 inline-block px-4 py-1.5 rounded-xl bg-surface-variant/10";
        statsContainer.onclick = null; // LOCKED

        document.getElementById('public-profile-bio').innerHTML = ''; 
        document.getElementById('public-profile-social-links').innerHTML = '';

        const actionsContainer = document.getElementById('public-profile-actions');
        if (connection?.status === 'pending' && connection.action_user_id === currentUserProfile.id) {
            actionsContainer.innerHTML = `<button class="btn-secondary w-full">Cancel Request</button>`;
            actionsContainer.firstElementChild.onclick = () => handleConnectionAction(user.id, 'cancel', actionsContainer.firstElementChild);
        } else {
            actionsContainer.innerHTML = `<button class="btn-primary w-full">Request to Connect</button>`;
            actionsContainer.firstElementChild.onclick = () => handleConnectionAction(user.id, 'request', actionsContainer.firstElementChild);
        }

        // Inject the Lock Screen into the feed area
        document.getElementById('public-profile-feed').innerHTML = `
            <div class="w-full bg-surface-variant/20 dark:bg-neutral-900/50 border border-surface-variant/50 dark:border-neutral-800 p-8 rounded-3xl mt-6 flex flex-col items-center justify-center shadow-inner">
                <span class="material-symbols-outlined text-[42px] text-on-surface-variant opacity-60 mb-3">lock</span>
                <h4 class="text-[16px] font-bold text-on-surface dark:text-gray-100 mb-1">This Account is Private</h4>
                <p class="text-[13px] text-on-surface-variant dark:text-gray-400 px-4 text-center">Connect to see their full profile and feed.</p>
            </div>
        `;
    } 
    // --- Handle PUBLIC Profile / PAGE Profile / CONNECTED PRIVATE Profile ---
    else {
        const statsHtml = user.role === 'page' ? 
            `<span id="public-profile-connection-count" class="font-bold text-on-surface dark:text-gray-200">${user.connection_count || 0}</span> followers` : 
            `<span id="public-profile-connection-count" class="font-bold text-on-surface dark:text-gray-200">${user.connection_count || 0}</span> connections`;
        
        // Enable Click & Route
        const statsContainer = document.getElementById('public-profile-connection-count').parentElement;
        statsContainer.innerHTML = statsHtml;
        statsContainer.className = "text-sm text-on-surface-variant dark:text-gray-400 mb-4 cursor-pointer hover:text-primary transition-colors inline-block px-4 py-1.5 rounded-xl bg-surface-variant/10 active:bg-surface-variant/20 active:scale-95";
        statsContainer.onclick = () => window.openUserConnectionsModal(user.id, user.role, user.full_name); // CLICKABLE!

        document.getElementById('public-profile-course').textContent = user.role === 'page' ? 'Official Page' : (user.course || 'Student');
        document.getElementById('public-profile-bio').textContent = user.bio || 'No bio available.';
        
        renderSocialLinks(user.social_links, document.getElementById('public-profile-social-links'));
        renderProfileActions(user, connection, followRecord);

        // Fetch their Posts Feed
        try {
            const { data: posts, error: postsError } = await supabase
                .from('posts').select(`*, users ( id, full_name, profile_img_url, role, tick_type ), post_likes ( user_id ), post_comments ( count ), post_poll_votes ( user_id, option_index )`)
                .eq('user_id', userId).eq('is_deleted', false).order('created_at', { ascending: false }).limit(20);

            if (postsError) throw postsError;

            if (posts.length === 0) {
                document.getElementById('public-profile-feed').innerHTML = `<div class="py-12 flex flex-col items-center justify-center opacity-40 text-on-surface-variant"><span class="material-symbols-outlined text-[42px] mb-2">photo_camera</span><p class="text-sm font-semibold">No posts yet</p></div>`;
                return;
            }
            document.getElementById('public-profile-feed').innerHTML = generatePostHTML(posts, currentUserProfile.id);
        } catch (postsErr) {
            document.getElementById('public-profile-feed').innerHTML = `<p class="text-sm text-center py-4 text-error">Failed to load posts feed.</p>`;
        }
    }
} // 🚀 CRITICAL: This is the closing brace that was missing!
function renderProfileActions(user, connection, followRecord) {
    const actionsContainer = document.getElementById('public-profile-actions');
    const moreMenuBtn = document.getElementById('public-profile-more-btn');
    const moreMenu = document.getElementById('public-profile-more-menu');

    actionsContainer.innerHTML = '';
    moreMenu.innerHTML = '';
    moreMenuBtn.classList.remove('hidden'); 
    moreMenu.classList.add('hidden');

    const userId = user.id;
    let mainButtonHtml = '';
    let moreMenuItems = [];

    // PAGE LOGIC
    if (user.role === 'page') {
        if (!followRecord) {
            mainButtonHtml = `<button onclick="handleFollowAction('${userId}', 'follow', this)" class="btn-primary flex-1 !py-2.5 rounded-xl text-sm">Follow</button>`;
        } else {
            const isNotifyOn = followRecord.receive_notifications;
            const bellIcon = isNotifyOn ? 'notifications_active' : 'notifications_off';
            
            // Clear visual indicator: Primary color + border when ON, Muted when OFF
            const bellStyle = isNotifyOn 
                ? 'bg-primary/15 text-primary border-primary/40 dark:bg-primary/20' 
                : 'bg-surface-variant/40 dark:bg-neutral-800 text-on-surface-variant/50 dark:text-gray-500 border-surface-variant/60';
            
            const bellTitle = isNotifyOn ? 'Notifications ON (Click to turn OFF)' : 'Notifications OFF (Click to turn ON)';

            mainButtonHtml = `
                <button onclick="handleFollowAction('${userId}', 'unfollow', this)" class="btn-secondary flex-1 !py-2.5 rounded-xl text-sm">Following</button>
                <button onclick="handleFollowAction('${userId}', 'toggle_bell', this, ${!isNotifyOn})" title="${bellTitle}" class="${bellStyle} !p-0 w-12 flex items-center justify-center border rounded-xl transition-all active:scale-95 shrink-0">
                    <span class="material-symbols-outlined text-[20px]" style="font-variation-settings: 'FILL' ${isNotifyOn ? 1 : 0};">${bellIcon}</span>
                </button>
            `;
        }
        moreMenuItems.push({ label: 'Report Page', action: 'report', class: 'text-orange-500' });
    } 
    // STUDENT LOGIC
    else {
        if (!connection) { 
            mainButtonHtml = `<button class="btn-primary flex-1 !py-2.5 rounded-xl text-sm">Connect</button>`;
            actionsContainer.innerHTML = mainButtonHtml;
            actionsContainer.firstElementChild.onclick = () => handleConnectionAction(userId, 'request', actionsContainer.firstElementChild);
            moreMenuItems.push({ label: 'Block User', action: 'block', class: 'text-error' });
        } else if (connection.status === 'pending') {
            if (connection.action_user_id === currentUserProfile.id) { 
                mainButtonHtml = `<button class="btn-secondary flex-1 !py-2.5 rounded-xl text-sm">Cancel Request</button>`;
                actionsContainer.innerHTML = mainButtonHtml;
                actionsContainer.firstElementChild.onclick = () => handleConnectionAction(userId, 'cancel', actionsContainer.firstElementChild);
            } else { 
                mainButtonHtml = `<button class="btn-primary flex-1 !py-2.5 rounded-xl text-sm">Accept</button><button class="btn-secondary flex-1 !py-2.5 rounded-xl text-sm">Decline</button>`;
                actionsContainer.innerHTML = mainButtonHtml;
                actionsContainer.children[0].onclick = () => handleConnectionAction(userId, 'accept', actionsContainer.children[0]);
                actionsContainer.children[1].onclick = () => handleConnectionAction(userId, 'decline', actionsContainer.children[1]);
            }
            moreMenuItems.push({ label: 'Block User', action: 'block', class: 'text-error' });
        } else if (connection.status === 'accepted') {
            mainButtonHtml = `<button class="btn-secondary flex-1 !py-2.5 rounded-xl text-sm" disabled>✓ Connected</button>`;
            actionsContainer.innerHTML = mainButtonHtml;
            moreMenuItems.push({ label: 'Remove connection', action: 'unfriend', class: 'text-error' });
            moreMenuItems.push({ label: 'Block User', action: 'block', class: 'text-error' });
        } else if (connection.status === 'blocked') {
            if (connection.action_user_id === currentUserProfile.id) { 
                mainButtonHtml = `<button class="btn-error flex-1 !py-2.5 rounded-xl text-sm">Unblock</button>`;
                actionsContainer.innerHTML = mainButtonHtml;
                actionsContainer.firstElementChild.onclick = () => handleConnectionAction(userId, 'unblock', actionsContainer.firstElementChild);
            } else { 
                mainButtonHtml = `<button class="btn-secondary flex-1 !py-2.5 rounded-xl text-sm" disabled>Blocked</button>`;
                actionsContainer.innerHTML = mainButtonHtml;
            }
        }
        if (!(connection?.status === 'blocked' && connection.action_user_id !== currentUserProfile.id)) {
            moreMenuItems.push({ label: 'Report User', action: 'report', class: 'text-orange-500' });
        }
    }

    if (user.role === 'page') {
        actionsContainer.innerHTML = mainButtonHtml;
    }

    if (moreMenuItems.length > 0) {
        moreMenu.innerHTML = moreMenuItems.map(item =>
            `<button data-action="${item.action}" class="w-full text-left px-4 py-2.5 text-sm font-bold hover:bg-surface-variant/30 dark:hover:bg-neutral-800 rounded-lg ${item.class} transition-colors">${item.label}</button>`
        ).join('');
    }
}

window.handleFollowAction = async function(pageId, action, btn, notifyState = true) {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-xl animate-spin">progress_activity</span>`;

    try {
        if (action === 'follow') {
            await supabase.from('page_followers').insert({ page_id: pageId, follower_id: currentUserProfile.id });
            await supabase.rpc('increment_connection_count', { user_id: pageId });
            
            // Trigger Notification to the Page
            await supabase.from('notifications').insert({
                user_id: pageId,
                sender_id: currentUserProfile.id,
                type: 'new_follower'
            });

            showToast('You are now following this page.', 'success');
        } else if (action === 'unfollow') {
            await supabase.from('page_followers').delete().match({ page_id: pageId, follower_id: currentUserProfile.id });
            await supabase.rpc('decrement_connection_count', { user_id: pageId });
            showToast('Unfollowed page.', 'info');
        } else if (action === 'toggle_bell') {
            await supabase.rpc('toggle_page_notifications', { p_page_id: pageId, p_follower_id: currentUserProfile.id, p_notify: notifyState });
            showToast(notifyState ? 'Notifications turned ON' : 'Notifications turned OFF', 'success');
        }
        viewUserProfile(pageId);
    } catch (error) {
        console.error('Follow action error:', error);
        showToast('Action failed.', 'error');
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

// ========================================================
// CONNECTION & BLOCKING ENGINE
// ========================================================
async function handleConnectionAction(targetUserId, action, btn) {
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-symbols-outlined text-xl animate-spin">progress_activity</span>`;
    }

    try {
        const { data, error } = await supabase.rpc('manage_connection', {
            p_target_user_id: targetUserId,
            p_action: action
        });

        if (error) throw error;
        
        const msg = typeof getSuccessMessage === 'function' ? getSuccessMessage(data) : 'Action successful!';
        showToast(msg, 'success');

        if (btn && action === 'request' && data === 'request_sent') btn.textContent = 'Request Sent';

        // Refresh the profile UI so the "Block" instantly changes to "Unblock"
        const modal = document.getElementById('modal-profile-public');
        if (modal && !modal.classList.contains('hidden') && modal.dataset.userId === targetUserId) {
            viewUserProfile(targetUserId);
        }

        // 🚀 FIX: Auto-refresh my own profile if I accept or remove a connection so my count updates!
        if (action === 'accept' || action === 'unfriend') {
            if (typeof window.refreshMyProfile === 'function') {
                window.refreshMyProfile();
            }
        }

    } catch (error) {
        console.error(`Error performing action '${action}':`, error);
        showToast(error.message || 'An error occurred.', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}
window.handleConnectionAction = handleConnectionAction;

function getSuccessMessage(result) {
    const messages = { request_sent: 'Connection request sent!', accepted: 'Connection accepted!', cancelled: 'Request cancelled.', declined: 'Request declined.', unfriended: 'Connection removed.', blocked: 'User blocked.', unblocked: 'User unblocked.' };
    return messages[result] || 'Action successful!';
}

function openReportModal(userId, userName) {
    const modal = document.getElementById('modal-report-user');
    modal.classList.replace('hidden', 'flex');
    document.getElementById('report-user-name').textContent = userName;
    document.getElementById('submit-report-btn').dataset.userId = userId;
}

function closeReportModal() {
    const modal = document.getElementById('modal-report-user');
    modal.classList.replace('flex', 'hidden');
    document.getElementById('report-reason').value = '';
    document.getElementById('report-description').value = '';
}

async function submitReport() {
    const btn = document.getElementById('submit-report-btn');
    const userId = btn.dataset.userId;
    const reason = document.getElementById('report-reason').value;
    const description = document.getElementById('report-description').value.trim();

    if (!reason) {
        showToast('Please select a reason for the report.', 'warning');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        const { error } = await supabase.rpc('create_report', { p_reported_user_id: userId, p_reason: reason, p_description: description || null });
        if (error) throw error;
        showToast('Report submitted successfully. Our team will review it.', 'success');
        closeReportModal();
        closeProfileModals();
    } catch (error) {
        showToast('Failed to submit report.', 'error');
        console.error('Error submitting report:', error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }
}

window.viewUserProfile = viewUserProfile;

// ==========================================
// LAZY-LOADING TAB ROUTER (Anti-Crash Fix)
// ==========================================
function switchTab(tabId) {
    document.querySelectorAll(".tab-content").forEach(tab => tab.classList.add("hidden"));
    
    const activeView = document.getElementById(`view-${tabId}`);
    if (activeView) activeView.classList.remove("hidden");

    const header = document.querySelector("header");
    if (tabId === "dashboard") header.classList.remove("hidden");
    else header.classList.add("hidden");

    const bottomNav = document.querySelector('nav');
    if (bottomNav) bottomNav.classList.remove('hidden');

    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.classList.remove("bg-primary", "text-white");
        btn.classList.add("text-on-surface-variant", "dark:text-gray-400");
        const icon = btn.querySelector(".material-symbols-outlined");
        if (icon) icon.style.fontVariationSettings = "'FILL' 0";
    });

    const activeBtn = document.getElementById(`nav-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.remove("text-on-surface-variant", "dark:text-gray-400");
        activeBtn.classList.add("bg-primary", "text-white");
        const icon = activeBtn.querySelector(".material-symbols-outlined");
        if (icon) icon.style.fontVariationSettings = "'FILL' 1";
    }

    window.scrollTo({ top: 0, behavior: "instant" });

    // 🚀 THE LAZY LOADER ENGINE
    if (window.loadedTabs && !window.loadedTabs.has(`view-${tabId}`)) {
        window.loadedTabs.add(`view-${tabId}`);
        if (tabId === 'search' && typeof window.refreshDiscover === 'function') window.refreshDiscover();
        else if (tabId === 'updates' && typeof window.refreshUpdates === 'function') window.refreshUpdates();
        else if (tabId === 'profile' && typeof window.fetchMyProfileFeed === 'function' && typeof currentUserProfile !== 'undefined') window.fetchMyProfileFeed(currentUserProfile.id);
    }
}
window.switchTab = switchTab; // Expose globally without crashing

function openProfileModal(type) {
    const modal = document.getElementById(`modal-profile-${type}`);
    if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => modal.classList.remove('translate-y-full'), 10);
    }
}

function closeProfileModals() {
    document.querySelectorAll('[id^="modal-profile-"]').forEach(modal => {
        if (!modal.classList.contains('translate-y-full')) {
            modal.classList.add('translate-y-full');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);
        }
    });
}

window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;
window.submitReport = submitReport;
window.toggleMoreMenu = () => document.getElementById('public-profile-more-menu').classList.toggle('hidden');

// ========================================================
// LIST MODALS (CONNECTIONS / BLOCKED) WITH SKELETONS
// ========================================================
async function openConnectionsModal() {
    const modal = document.getElementById('modal-connections');
    const list = document.getElementById('connections-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = LIST_SKELETON; 

    try {
        const { data, error } = await supabase
            .from('connections')
            .select('status, user_one:user_one_id(id, full_name, profile_img_url, course), user_two:user_two_id(id, full_name, profile_img_url, course)')
            .or(`user_one_id.eq.${currentUserProfile.id},user_two_id.eq.${currentUserProfile.id}`)
            .eq('status', 'accepted');

        if (error) throw error;

        const connections = data.map(conn => conn.user_one.id === currentUserProfile.id ? conn.user_two : conn.user_one).filter(Boolean); 

        if (connections.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">You have no connections yet.</p>`;
            return;
        }

        list.innerHTML = connections.map(user => {
            const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
            const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
            const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;

            return `
            <div onclick="window.viewUserProfile('${user.id}'); closeConnectionsModal();" class="flex items-center gap-4 p-3 bg-surface-container-lowest dark:bg-neutral-900/50 rounded-2xl border border-surface-variant/40 dark:border-neutral-800 shadow-sm cursor-pointer hover:bg-surface-variant/20 transition-colors">
                <img loading="lazy" src="${optimizedAvatar}" onerror="${fallback}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/50 shrink-0">
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm text-on-surface dark:text-gray-100 truncate">${user.full_name}</p>
                    <p class="text-[11px] text-on-surface-variant dark:text-gray-400 mt-0.5 truncate">${user.course || 'Student'}</p>
                </div>
            </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error fetching connections:', error);
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load connections.</p>`;
    }
}

function closeConnectionsModal() {
    const modal = document.getElementById('modal-connections');
    if (modal) modal.classList.replace('flex', 'hidden');
}

window.openConnectionsModal = openConnectionsModal;
window.closeConnectionsModal = closeConnectionsModal;

// ========================================================
// FOLLOWERS MODAL (For Pages)
// ========================================================
window.handleProfileStatsClick = function() {
    if (currentUserProfile.role === 'page') {
        openFollowersModal();
    } else {
        openConnectionsModal();
    }
};

async function openFollowersModal() {
    const modal = document.getElementById('modal-followers');
    const list = document.getElementById('followers-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = LIST_SKELETON; 

    try {
        const { data, error } = await supabase
            .from('page_followers')
            .select('users!page_followers_follower_id_fkey(id, full_name, profile_img_url, course)')
            .eq('page_id', currentUserProfile.id);

        if (error) throw error;

        // Clean up the nested Supabase response
        const followers = data.map(f => f.users).filter(Boolean);

        if (followers.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">You have no followers yet.</p>`;
            return;
        }

        list.innerHTML = followers.map(user => {
            const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
            const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
            const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;

            return `
            <div onclick="window.viewUserProfile('${user.id}'); closeFollowersModal();" class="flex items-center gap-4 p-3 bg-surface-container-lowest dark:bg-neutral-900/50 rounded-2xl border border-surface-variant/40 dark:border-neutral-800 shadow-sm cursor-pointer hover:bg-surface-variant/20 transition-colors">
                <img loading="lazy" src="${optimizedAvatar}" onerror="${fallback}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/50 shrink-0">
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm text-on-surface dark:text-gray-100 truncate">${user.full_name}</p>
                    <p class="text-[11px] text-on-surface-variant dark:text-gray-400 mt-0.5 truncate">${user.course || 'Student'}</p>
                </div>
            </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error fetching followers:', error);
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load followers.</p>`;
    }
}

function closeFollowersModal() {
    const modal = document.getElementById('modal-followers');
    if (modal) modal.classList.replace('flex', 'hidden');
}

window.openFollowersModal = openFollowersModal;
window.closeFollowersModal = closeFollowersModal;

async function openBlockedUsersModal() {
    const modal = document.getElementById('modal-blocked-users');
    const list = document.getElementById('blocked-users-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = LIST_SKELETON; 

    try {
        const { data, error } = await supabase
            .from('connections')
            .select('user_one:user_one_id(id, full_name, profile_img_url, course), user_two:user_two_id(id, full_name, profile_img_url, course)')
            .eq('status', 'blocked')
            .eq('action_user_id', currentUserProfile.id);

        if (error) throw error;

        const blockedUsers = data.map(conn => conn.user_one.id === currentUserProfile.id ? conn.user_two : conn.user_one).filter(Boolean);

        if (blockedUsers.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">You haven't blocked anyone.</p>`;
            return;
        }

      list.innerHTML = blockedUsers.map(user => {
            const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
            const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
            const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;

            return `
            <div class="flex items-center gap-4 p-3 bg-surface-container-lowest dark:bg-neutral-900/50 rounded-2xl border border-surface-variant/40 dark:border-neutral-800 shadow-sm">
                <img loading="lazy" src="${optimizedAvatar}" onerror="${fallback}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/50 shrink-0">
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm text-on-surface dark:text-gray-100 truncate">${user.full_name}</p>
                    <p class="text-[11px] text-on-surface-variant dark:text-gray-400 mt-0.5 truncate">${user.course || 'Student'}</p>
                </div>
                <button data-user-id="${user.id}" class="unblock-btn bg-error/10 text-error px-4 py-2 rounded-xl text-xs font-bold active:scale-95 transition-transform hover:bg-error/20 shrink-0">
                    Unblock
                </button>
            </div>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error fetching blocked users:', error);
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load blocked users.</p>`;
    }
}

function closeBlockedUsersModal() {
    const modal = document.getElementById('modal-blocked-users');
    if (modal) modal.classList.replace('flex', 'hidden');
}

window.openBlockedUsersModal = openBlockedUsersModal;
window.closeBlockedUsersModal = closeBlockedUsersModal;

// ========================================================
// SINGLE POST VIEWER ENGINE
// ========================================================
window.openSinglePostView = async function(postId) {
    const modal = document.getElementById('modal-single-post');
    const container = document.getElementById('single-post-container');
    const bottomNav = document.querySelector('nav');
    
    modal.classList.replace('hidden', 'flex');
    if (bottomNav) bottomNav.classList.add('hidden');
    setTimeout(() => modal.classList.remove('translate-x-full'), 10);
    
    container.innerHTML = FEED_SKELETON; 
    
    try {
        const { data: posts, error } = await supabase
            .from('posts')
            .select(`
                *,
                users ( id, full_name, profile_img_url, role, tick_type ),
                post_likes ( user_id ),
                post_comments ( count ),
                post_poll_votes ( user_id, option_index )
            `)
            .eq('id', postId)
            .eq('is_deleted', false);
            
        if (error) throw error;
        
        if (!posts || posts.length === 0) {
            container.innerHTML = `
                <div class="py-16 flex flex-col items-center justify-center opacity-40 text-on-surface-variant">
                    <span class="material-symbols-outlined text-[48px] mb-2">delete</span>
                    <p class="text-sm font-semibold">Post no longer available</p>
                </div>`;
            return;
        }
        
        container.innerHTML = generatePostHTML(posts, currentUserProfile.id);

    } catch (error) {
        console.error('Error fetching single post:', error);
        container.innerHTML = `<p class="text-sm text-center py-10 text-error">Failed to load post.</p>`;
    }
}

window.closeSinglePostView = function() {
    const modal = document.getElementById('modal-single-post');
    modal.classList.add('translate-x-full');
    
    const notifModal = document.getElementById('modal-notifications');
    if (notifModal && notifModal.classList.contains('hidden')) {
        const bottomNav = document.querySelector('nav');
        if (bottomNav) bottomNav.classList.remove('hidden');
    }
    
    setTimeout(() => modal.classList.replace('flex', 'hidden'), 300);

    };
// ========================================================
// NATIVE ANDROID BACK BUTTON ROUTER (The Waterfall)
// ========================================================
function setupAppBackButton() {
    
    const checkAndCloseTopLayer = () => {
     const modalHierarchy = [
            // 🚀 NEW: Close Image Viewers and Peeks on Back Press
            { id: 'modal-dp-viewer', close: () => window.closeDpViewer() },
            { id: 'modal-profile-peek', close: () => window.closeProfilePeek() },
            
            { id: 'modal-confirm-action', close: () => document.getElementById('confirm-action-no')?.click() },
            { id: 'modal-action-sheet', close: () => window.closeActionSheet() },
            { id: 'modal-story-details', close: () => document.getElementById('activity-backdrop-close')?.click() },
            { id: 'modal-post-comments', close: () => document.getElementById('close-post-comments-btn')?.click() },
            { id: 'modal-poll-voters', close: () => document.getElementById('modal-poll-voters').classList.replace('flex','hidden') },
            { id: 'modal-report-post', close: () => window.closeReportPostModal() },
            { id: 'modal-report-user', close: () => window.closeReportModal() },
            { id: 'modal-edit-socials', close: () => window.closeSocialsModal() },
            { id: 'modal-edit-profile', close: () => window.closeEditProfileModal() },
            { id: 'modal-connections', close: () => window.closeConnectionsModal() },
            { id: 'modal-followers', close: () => window.closeFollowersModal() },
            { id: 'modal-blocked-users', close: () => window.closeBlockedUsersModal() },
            { id: 'modal-single-post', close: () => window.closeSinglePostView() },
            { id: 'modal-notifications', close: () => window.closeNotifications() },
            { id: 'modal-view-connections', close: () => window.closeUserConnectionsModal() },
            
            // --- NEW: Hardware back support for sub-panels ---
            { id: 'settings-password-panel', close: () => window.closeSettingsSubPanel('settings-password-panel') },
            { id: 'settings-deactivate-panel', close: () => window.closeSettingsSubPanel('settings-deactivate-panel') },
            { id: 'settings-delete-panel', close: () => window.closeSettingsSubPanel('settings-delete-panel') },
            { id: 'settings-notifications-panel', close: () => window.closeSettingsSubPanel('settings-notifications-panel') },
            { id: 'settings-account-panel', close: () => window.closeSettingsSubPanel('settings-account-panel') },
            // -------------------------------------------------

            { id: 'settings-sidebar', close: () => window.closeSettingsSidebar() },
            { id: 'view-create-post', close: () => window.closeCreatePostView() },
            { id: 'modal-profile-public', close: () => window.closeProfileModals() },
            { id: 'modal-profile-private', close: () => window.closeProfileModals() },
            { id: 'modal-hotpost-camera', close: () => document.getElementById('close-hotpost-camera-btn')?.click() },
            { id: 'modal-view-hotpost', close: () => document.getElementById('close-hotpost-viewer-btn')?.click() },
            { id: 'modal-course-picker', close: () => window.closeCoursePicker() }
        ];
        // Remember to change the check loop to use 'hidden' OR 'translate-x-full' for the sub-panels:
        for (const modal of modalHierarchy) {
            const el = document.getElementById(modal.id);
            if (el && (!el.classList.contains('hidden') && !el.classList.contains('translate-x-full'))) {
                modal.close(); 
                return true; 
            }
        }

        const dashboardView = document.getElementById('view-dashboard');
        if (dashboardView && dashboardView.classList.contains('hidden')) {
            if (window.switchTab) window.switchTab('dashboard'); 
            return true; 
        }

        return false; 
    };

    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        try {
            const App = window.Capacitor.Plugins.App;
            if (App) {
                App.addListener('backButton', () => {
                    const handled = checkAndCloseTopLayer();
                    if (!handled) {
                        App.exitApp(); 
                    }
                });
            }
        } catch (err) {
            console.warn('Capacitor App plugin bypassed.', err);
        }
    } 
    
    window.history.pushState({ app_active: true }, "");
    
    window.addEventListener('popstate', () => {
        const handled = checkAndCloseTopLayer();
        if (handled) {
            window.history.pushState({ app_active: true }, "");
        } 
    });
}
// ========================================================
// CUSTOM COURSE PICKER ENGINE
// ========================================================
window.openCoursePicker = function() {
    const picker = document.getElementById('modal-course-picker');
    picker.classList.replace('hidden', 'flex');
};

window.closeCoursePicker = function() {
    const picker = document.getElementById('modal-course-picker');
    picker.classList.replace('flex', 'hidden');
};

window.selectCourse = function(courseName) {
    document.getElementById('edit-profile-course').value = courseName;
    closeCoursePicker();
};

// ========================================================
// SMART SOCIAL PLATFORM PICKER ENGINE
// ========================================================
const socialPlatformsConfig = {
    instagram: { name: 'Instagram', icon: 'fa-brands fa-instagram', color: 'bg-gradient-to-br from-purple-400 via-pink-500 to-red-500 text-white', placeholder: 'Username (e.g. johndoe)', type: 'text', prefix: 'https://instagram.com/' },
    snapchat: { name: 'Snapchat', icon: 'fa-brands fa-snapchat', color: 'bg-[#FFFC00] text-black', placeholder: 'Snapchat Username', type: 'text', prefix: 'https://snapchat.com/add/' },
    whatsapp: { name: 'WhatsApp', icon: 'fa-brands fa-whatsapp', color: 'bg-[#25D366] text-white', placeholder: 'Phone Number (e.g. 919876543210)', type: 'tel', prefix: 'https://wa.me/' },
    linkedin: { name: 'LinkedIn', icon: 'fa-brands fa-linkedin-in', color: 'bg-[#0A66C2] text-white', placeholder: 'LinkedIn Username', type: 'text', prefix: 'https://linkedin.com/in/' },
    twitter: { name: 'X (Twitter)', icon: 'fa-brands fa-x-twitter', color: 'bg-black dark:bg-white text-white dark:text-black', placeholder: 'X Username', type: 'text', prefix: 'https://x.com/' },
    spotify: { name: 'Spotify', icon: 'fa-brands fa-spotify', color: 'bg-[#1DB954] text-white', placeholder: 'Spotify Profile URL', type: 'url', prefix: '' },
    telegram: { name: 'Telegram', icon: 'fa-brands fa-telegram', color: 'bg-[#229ED9] text-white', placeholder: 'Telegram Username', type: 'text', prefix: 'https://t.me/' },
    discord: { name: 'Discord', icon: 'fa-brands fa-discord', color: 'bg-[#5865F2] text-white', placeholder: 'Discord Username', type: 'text', prefix: 'https://discord.com/users/' },
    reddit: { name: 'Reddit', icon: 'fa-brands fa-reddit-alien', color: 'bg-[#FF4500] text-white', placeholder: 'Reddit Username', type: 'text', prefix: 'https://reddit.com/user/' },
    github: { name: 'GitHub', icon: 'fa-brands fa-github', color: 'bg-[#181717] dark:bg-white text-white dark:text-black', placeholder: 'GitHub Username', type: 'text', prefix: 'https://github.com/' },
    youtube: { name: 'YouTube', icon: 'fa-brands fa-youtube', color: 'bg-[#FF0000] text-white', placeholder: 'Channel URL or @handle', type: 'text', prefix: 'https://youtube.com/' },
    website: { name: 'Website', icon: 'fa-solid fa-globe', color: 'bg-primary text-white', placeholder: 'example.com', type: 'url', prefix: 'https://' }
};

window.openSocialPicker = function() {
    const list = document.getElementById('social-picker-list');
    list.innerHTML = '';
    
    Object.keys(socialPlatformsConfig).forEach(key => {
        const config = socialPlatformsConfig[key];
        list.innerHTML += `
            <button onclick="selectSocialPlatform('${key}')" class="w-full flex items-center gap-4 p-3.5 rounded-2xl hover:bg-surface-variant/30 dark:hover:bg-neutral-800 transition-colors active:scale-[0.98] text-left border border-transparent hover:border-surface-variant/50 dark:hover:border-neutral-700">
                <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${config.color}">
                    <i class="${config.icon} text-[18px]"></i>
                </div>
                <span class="font-extrabold text-[15px] text-on-surface dark:text-gray-100 tracking-wide">${config.name}</span>
            </button>
        `;
    });
    
    document.getElementById('modal-social-picker').classList.replace('hidden', 'flex');
};

window.closeSocialPicker = function() {
    document.getElementById('modal-social-picker').classList.replace('flex', 'hidden');
};

window.selectSocialPlatform = function(id) {
    const config = socialPlatformsConfig[id];
    
    document.getElementById('add-social-platform').value = id;
    document.getElementById('selected-social-name').textContent = config.name;
    document.getElementById('selected-social-icon').className = config.icon + ' text-[16px]';
    document.getElementById('selected-social-icon-box').className = `w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm ${config.color}`;
    
    const input = document.getElementById('add-social-url');
    input.type = config.type;
    input.placeholder = config.placeholder;
    input.value = ''; 
    
    closeSocialPicker();
};

// ========================================================
// NATIVE LONG-PRESS ENGINE (Profile Peek & DP Viewer)
// ========================================================
let longPressTimer;
window.isLongPressing = false; 

document.addEventListener('touchstart', handleTouchStart, { passive: true });
document.addEventListener('touchend', handleTouchEnd);
document.addEventListener('touchmove', handleTouchMove, { passive: true });
document.addEventListener('mousedown', handleTouchStart);
document.addEventListener('mouseup', handleTouchEnd);
document.addEventListener('mousemove', handleTouchMove);

let touchStartX = 0;
let touchStartY = 0;

function handleTouchStart(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;

    const profileLink = e.target.closest('.profile-link');
    const dpLink = e.target.closest('.dp-link');
    
    if (!profileLink && !dpLink) return;

    // 🚀 FIX: Safely record start position for BOTH touch screens and desktop clicks
    if (e.touches && e.touches.length > 0) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    } else if (e.clientX !== undefined) {
        touchStartX = e.clientX;
        touchStartY = e.clientY;
    }

    clearTimeout(longPressTimer);
    window.isLongPressing = false;
    
    longPressTimer = setTimeout(() => {
        window.isLongPressing = true;
        if (navigator.vibrate) navigator.vibrate(50);
        
        if (dpLink) {
            const imgSrc = dpLink.src || '';
            window.openDpViewer(imgSrc);
        } else if (profileLink) {
            const userId = profileLink.dataset.userId;
            
            // Ensure we are passing an image to the viewer, even if they tapped the wrapper div
            let imgEl = profileLink;
            if (profileLink.tagName !== 'IMG') {
                imgEl = profileLink.querySelector('img') || profileLink;
            }
            
            if (userId) window.openProfilePeek(userId, imgEl);
        }
    }, 400); 
}

function handleTouchMove(e) {
    let moveX, moveY;

    // 🚀 FIX: Intelligently extract coordinates without crashing
    if (e.touches && e.touches.length > 0) {
        moveX = e.touches[0].clientX;
        moveY = e.touches[0].clientY;
    } else if (e.clientX !== undefined) {
        moveX = e.clientX;
        moveY = e.clientY;
    } else {
        // If Android fires a ghost event with no coordinates, DO NOTHING! 
        // (This is what was killing the old profile cards)
        return; 
    }
    
    // Only cancel if they ACTUALLY dragged their finger more than 10 pixels
    if (Math.abs(moveX - touchStartX) > 10 || Math.abs(moveY - touchStartY) > 10) {
        clearTimeout(longPressTimer);
    }
}

function handleTouchEnd(e) {
    clearTimeout(longPressTimer);
    
    if (window.isLongPressing) {
        if (e.cancelable) e.preventDefault();
        setTimeout(() => { window.isLongPressing = false; }, 300);
    }
}

// ===============================================
// 1. FEED PEEK CARD LOGIC
// ===============================================
window.openProfilePeek = async function(userId, imgEl) {
    const modal = document.getElementById('modal-profile-peek');
    const card = document.getElementById('peek-card');
    
    if (!modal || !card) return; // Failsafe

    if (imgEl && imgEl.tagName === 'IMG') {
        document.getElementById('peek-avatar').src = imgEl.src;
    }
    
    document.getElementById('peek-name').innerHTML = 'Loading...';
    document.getElementById('peek-course').textContent = 'Fetching details...';
    
    modal.classList.replace('hidden', 'flex');
    modal.style.pointerEvents = 'auto';

    setTimeout(() => {
        modal.classList.remove('opacity-0');
        card.classList.remove('scale-90');
    }, 10);

    try {
        const { data: user, error } = await supabase.from('users').select('full_name, profile_img_url, course, tick_type').eq('id', userId).single();
        if (error) throw error;
        
        const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(user.profile_img_url, 'avatar') : user.profile_img_url;
        document.getElementById('peek-avatar').src = optimizedAvatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
        
       // 🚀 FAILSAFE 3: Strict Hex Code Generator 
        let verifiedBadge = '';
        if (user.tick_type && user.tick_type.toLowerCase().trim() !== 'none') {
            verifiedBadge = `<span class="material-symbols-outlined text-[14px]" style="color: ${user.tick_type.trim()}; font-variation-settings: 'FILL' 1;">verified</span>`;
        }
        
        document.getElementById('peek-name').innerHTML = `${user.full_name} ${verifiedBadge}`;
        document.getElementById('peek-course').textContent = user.course || 'Campus Member';
        
        document.getElementById('peek-view-profile-btn').onclick = () => {
            window.closeProfilePeek();
            setTimeout(() => window.viewUserProfile(userId), 200); 
        };
    } catch (err) {
        document.getElementById('peek-name').textContent = 'User Details Unavailable';
        document.getElementById('peek-course').textContent = '';
    }
}

window.closeProfilePeek = function() {
    const modal = document.getElementById('modal-profile-peek');
    const card = document.getElementById('peek-card');
    if (!modal || !card) return;
    
    modal.style.pointerEvents = 'none';
    modal.classList.add('opacity-0');
    card.classList.add('scale-90');
    
    setTimeout(() => {
        modal.classList.replace('flex', 'hidden');
        modal.style.pointerEvents = 'auto';
    }, 300);
}

// ===============================================
// 2. PROFILE DP VIEWER LOGIC (Instagram Style)
// ===============================================
window.openDpViewer = function(imgSrc) {
    const modal = document.getElementById('modal-dp-viewer');
    const card = document.getElementById('dp-viewer-card');
    const avatarImg = document.getElementById('dp-viewer-image');

    if (!modal || !card || !avatarImg) return; // Failsafe

    if (imgSrc && typeof imgSrc === 'string' && imgSrc.includes('cloudinary.com') && imgSrc.includes('w_150')) {
        imgSrc = imgSrc.replace('w_150,h_150', 'w_600,h_600');
    }
    
    avatarImg.src = imgSrc || '';

    modal.classList.replace('hidden', 'flex');
    modal.style.pointerEvents = 'auto';

    setTimeout(() => {
        modal.classList.remove('opacity-0');
        card.classList.remove('scale-90');
    }, 10);
};

window.closeDpViewer = function() {
    const modal = document.getElementById('modal-dp-viewer');
    const card = document.getElementById('dp-viewer-card');
    if (!modal || !card) return;
    
    modal.style.pointerEvents = 'none';
    modal.classList.add('opacity-0');
    
    // Clear any inline scale/translate transforms generated by the pinch-to-zoom engine
    card.style.transform = '';
    card.classList.add('scale-90');
    
    setTimeout(() => {
        modal.classList.replace('flex', 'hidden');
        modal.style.pointerEvents = 'auto';
    }, 300);
};

// 🚀 NEW: Instagram-Style Pinch to Zoom & Drag Physics Engine
function setupDpViewerPhysics() {
    const viewer = document.getElementById('modal-dp-viewer');
    const card = document.getElementById('dp-viewer-card');
    if (!viewer || !card) return;

    let initialPinchDist = 0;
    let currentScale = 1;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    
    viewer.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Calculate the distance and center point between two fingers
            initialPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            startX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            startY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            
            card.style.transition = 'none'; // Lock tracking strictly to fingers (no lag)
        }
    }, { passive: true });

    viewer.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            if (e.cancelable) e.preventDefault(); // Lock background scrolling
            
            // Calculate Zoom
            const currentDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            currentScale = Math.max(1, Math.min(currentDist / initialPinchDist, 4)); // Max 4x zoom
            
            // Calculate Drag
            const moveX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const moveY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            currentX = moveX - startX;
            currentY = moveY - startY;

            // Apply transformations
            card.style.transform = `translate(${currentX}px, ${currentY}px) scale(${currentScale})`;
        }
    }, { passive: false });

    viewer.addEventListener('touchend', (e) => {
        // If they release 1 or both fingers, snap back to the center instantly
        if (e.touches.length < 2 && currentScale > 1) {
            currentScale = 1;
            currentX = 0;
            currentY = 0;
            card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
            card.style.transform = 'translate(0px, 0px) scale(1)';
        }
    }, { passive: true });
}

// Boot the physics engine
document.addEventListener('DOMContentLoaded', setupDpViewerPhysics);

// ========================================================
// GLOBAL BLOCK & FILTER LOGIC
// ========================================================
window.getBlockedUserIds = async function(currentUserId) {
    try {
        const { data } = await supabase
            .from('connections')
            .select('user_one_id, user_two_id')
            .eq('status', 'blocked')
            .or(`user_one_id.eq.${currentUserId},user_two_id.eq.${currentUserId}`);
        
        if (!data) return [];
        // Extract the ID of the "other" person in the blocked relationship
        return data.map(c => c.user_one_id === currentUserId ? c.user_two_id : c.user_one_id);
    } catch (e) {
        console.error("Error fetching blocked list:", e);
        return [];
    }
};

// ========================================================
// NATIVE NESTED SETTINGS ROUTING & LOGIC
// ========================================================

// ========================================================
// NATIVE NESTED SETTINGS ROUTING & LOGIC
// ========================================================

window.openSettingsSubPanel = function(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.classList.remove('translate-x-full');
    }
};

window.closeSettingsSubPanel = function(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.classList.add('translate-x-full');
    }
};

// 1. Change Password (Fixed Auth Dependency)
window.executeChangePassword = async function() {
    const oldPw = document.getElementById('cp-old').value;
    const newPw = document.getElementById('cp-new').value;
    const confirmPw = document.getElementById('cp-confirm').value;
    const btn = document.getElementById('btn-change-password');
    const errorDiv = document.getElementById('cp-error-msg');

    // Reset UI
    errorDiv.classList.add('hidden');
    errorDiv.textContent = '';
    
    const showError = (msg) => {
        errorDiv.textContent = msg;
        errorDiv.classList.remove('hidden');
    };

    if (!oldPw || !newPw || !confirmPw) return showError('Please fill all fields.');
    if (newPw !== confirmPw) return showError('New passwords do not match.');
    if (newPw.length < 6) return showError('Password must be at least 6 characters.');

    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin">progress_activity</span>`;

    try {
        // Guarantee we have the active session email
        const { data: { user }, error: userErr } = await supabase.auth.getUser();
        if (userErr || !user) throw new Error("Could not verify active user session.");

        // Step 1: Re-authenticate to verify old password
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: user.email,
            password: oldPw
        });

        if (authError) {
            btn.disabled = false;
            btn.innerHTML = originalText;
            return showError('Incorrect Current Password.');
        }

        // Step 2: Update Password securely
        const { error: updateError } = await supabase.auth.updateUser({ password: newPw });
        if (updateError) throw updateError;

        showToast('Password updated successfully!', 'success');
        document.getElementById('cp-old').value = '';
        document.getElementById('cp-new').value = '';
        document.getElementById('cp-confirm').value = '';
        closeSettingsSubPanel('settings-password-panel');

    } catch (err) {
        console.error("Change Password Error:", err);
        showError(err.message || 'Failed to update password.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

// 2. Deactivate Account
window.executeDeactivateAccount = async function() {
    const btn = document.getElementById('btn-deactivate-final');
    btn.textContent = 'Deactivating...';
    btn.disabled = true;

    try {
        await supabase.from('users').update({ is_deactivated: true }).eq('id', currentUserProfile.id);
        await supabase.auth.signOut();
        window.location.replace('auth/login.html');
    } catch (e) {
        showToast('Failed to deactivate.', 'error');
        btn.textContent = 'Deactivate Now';
        btn.disabled = false;
    }
};

// 3. Delete Account
window.executeDeleteAccount = async function() {
    const btn = document.getElementById('btn-delete-final');
    btn.textContent = 'Deleting...';
    btn.disabled = true;
    
    try {
        await supabase.from('users').update({ is_deleted: true }).eq('id', currentUserProfile.id);
        await supabase.auth.signOut();
        window.location.replace('auth/login.html'); 
    } catch (e) {
        showToast('Failed to delete.', 'error');
        btn.textContent = 'Permanently Delete Account';
        btn.disabled = false;
    }
};

// 4. Manage Notification Settings
window.fetchNotificationSettings = async function() {
    const list = document.getElementById('notification-settings-list');
    list.innerHTML = `<p class="text-sm italic text-center py-4 text-on-surface-variant dark:text-gray-400">Loading...</p>`;

    try {
        const { data, error } = await supabase
            .from('page_followers')
            .select('receive_notifications, page_id, users!page_followers_page_id_fkey(full_name, profile_img_url)')
            .eq('follower_id', currentUserProfile.id);

        if (error) throw error;

        if (data.length === 0) {
            list.innerHTML = `<p class="text-sm text-center py-8 text-on-surface-variant dark:text-gray-500">You are not following any pages.</p>`;
            return;
        }

        list.innerHTML = data.map(item => `
            <div class="flex items-center justify-between p-3 bg-surface-container-lowest dark:bg-neutral-900/50 rounded-2xl border border-surface-variant/40 dark:border-neutral-800 shadow-sm mb-2">
                <div class="flex items-center gap-3">
                    <img src="${item.users.profile_img_url}" class="w-10 h-10 rounded-full object-cover border border-surface-variant/50">
                    <p class="font-bold text-[14px] text-on-surface dark:text-gray-100">${item.users.full_name}</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" onchange="togglePageBell('${item.page_id}', this.checked)" class="sr-only peer" ${item.receive_notifications ? 'checked' : ''}>
                    <div class="w-11 h-6 bg-surface-variant dark:bg-neutral-700 rounded-full peer peer-checked:bg-primary peer-checked:after:translate-x-full after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                </label>
            </div>
        `).join('');

    } catch (err) {
        console.error('Error fetching notification settings:', err);
        list.innerHTML = `<p class="text-sm text-center py-4 text-error">Failed to load settings.</p>`;
    }
};

window.togglePageBell = async function(pageId, notifyState) {
    try {
        await supabase.rpc('toggle_page_notifications', { p_page_id: pageId, p_follower_id: currentUserProfile.id, p_notify: notifyState });
        showToast(notifyState ? 'Alerts ON' : 'Alerts OFF', 'success');
    } catch (err) {
        console.error('Failed to toggle alert', err);
        showToast('Failed to update setting.', 'error');
    }
};
// ========================================================
// PUBLIC CONNECTIONS VIEWER (Instagram Style List)
// ========================================================
let currentViewedConnections = []; // Stores list for live search

window.openUserConnectionsModal = async function(userId, role, userName) {
    const modal = document.getElementById('modal-view-connections');
    const title = document.getElementById('view-connections-title');
    const list = document.getElementById('view-connections-list');
    const searchInput = document.getElementById('view-connections-search');

    modal.classList.replace('hidden', 'flex');
    setTimeout(() => modal.classList.remove('translate-x-full'), 10);

    title.textContent = userName;
    searchInput.value = '';
    list.innerHTML = LIST_SKELETON; // Show loading shimmer
    currentViewedConnections = [];

    try {
        let users = [];

        if (role === 'page') {
            const { data, error } = await supabase
                .from('page_followers')
                .select('users!page_followers_follower_id_fkey(id, full_name, profile_img_url, course, tick_type)')
                .eq('page_id', userId);
            if (error) throw error;
            users = data.map(f => f.users).filter(Boolean);
        } else {
            const { data, error } = await supabase
                .from('connections')
                .select('user_one:user_one_id(id, full_name, profile_img_url, course, tick_type), user_two:user_two_id(id, full_name, profile_img_url, course, tick_type)')
                .or(`user_one_id.eq.${userId},user_two_id.eq.${userId}`)
                .eq('status', 'accepted');
            if (error) throw error;
            users = data.map(conn => conn.user_one.id === userId ? conn.user_two : conn.user_one).filter(Boolean);
        }

        currentViewedConnections = users;
        renderViewConnectionsList(users);

        // 🚀 LIVE SEARCH FILTER
        searchInput.oninput = (e) => {
            const q = e.target.value.toLowerCase().trim();
            const filtered = currentViewedConnections.filter(u => 
                u.full_name.toLowerCase().includes(q) || 
                (u.course && u.course.toLowerCase().includes(q))
            );
            renderViewConnectionsList(filtered, q !== '');
        };

    } catch (error) {
        console.error('Error fetching user connections:', error);
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load list.</p>`;
    }
};

window.closeUserConnectionsModal = function() {
    const modal = document.getElementById('modal-view-connections');
    modal.classList.add('translate-x-full');
    setTimeout(() => modal.classList.replace('flex', 'hidden'), 300);
};

function renderViewConnectionsList(users, isSearch = false) {
    const list = document.getElementById('view-connections-list');

    if (users.length === 0) {
        list.innerHTML = `<div class="py-16 flex flex-col items-center justify-center opacity-40 text-on-surface-variant"><span class="material-symbols-outlined text-[42px] mb-2">group_off</span><p class="text-sm font-semibold">${isSearch ? 'No users found.' : 'No connections yet.'}</p></div>`;
        return;
    }

    list.innerHTML = users.map(user => {
        const optimizedAvatar = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(user.profile_img_url, 'avatar') : user.profile_img_url;
        const fallback = `this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4';`;
        const tickHtml = window.getTickHtml ? window.getTickHtml(user.tick_type) : '';

        return `
        <div onclick="window.closeUserConnectionsModal(); setTimeout(() => window.viewUserProfile('${user.id}'), 150);" class="flex items-center gap-3.5 p-3 hover:bg-surface-variant/20 dark:hover:bg-neutral-800/50 rounded-2xl cursor-pointer active:scale-[0.98] transition-all">
            <img loading="lazy" src="${optimizedAvatar || fallback}" onerror="${fallback}" class="w-12 h-12 rounded-full object-cover border border-surface-variant/50 shrink-0">
            <div class="flex-1 min-w-0">
                <p class="font-bold text-[14.5px] text-on-surface dark:text-gray-100 truncate flex items-center gap-1">${user.full_name} ${tickHtml}</p>
                <p class="text-[12px] font-medium text-on-surface-variant dark:text-gray-500 mt-0.5 truncate">${user.course || 'Student'}</p>
            </div>
            <button class="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-variant/50 transition-colors shrink-0">
                <span class="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
        </div>
        `;
    }).join('');
}
// ========================================================
// PREFERENCES & PRIVACY UPDATES
// ========================================================
window.updateMentionPrivacy = async function(val) {
    try {
        const { error } = await supabase
            .from('users')
            .update({ mention_privacy: val })
            .eq('id', currentUserProfile.id);
            
        if (error) throw error;
        
        currentUserProfile.mention_privacy = val;
        showToast(`Mentions allowed from: ${val === 'connections' ? 'My Connections' : 'No One'}`, 'success');
        
    } catch (err) {
        console.error("Mention privacy error:", err);
        showToast('Failed to update settings', 'error');
        // Revert UI if DB fails
        document.getElementById('mention-privacy-select').value = currentUserProfile.mention_privacy || 'connections';
    }
};
