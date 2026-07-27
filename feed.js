import { supabase } from './supabase.js';
import { showToast } from './ui.js';
import { timeAgo, compressImage } from './utils.js'; // <-- Add compressImage here
import { CLOUDINARY_CLOUD_NAME } from './config.js';

let currentUser = null;
let isVoting = false; 

let quillEditor = null;
let commentQuillEditor = null; // <-- NEW

function initCommentQuill() {
    if (commentQuillEditor) return;
    
    commentQuillEditor = new Quill('#post-comment-input', {
        theme: 'snow',
        placeholder: 'Add a comment... (@ to mention)',
        modules: {
            toolbar: false, // Hide toolbar for comments! Just text and mentions.
            mention: {
                allowedChars: /^[A-Za-z\sÅÄÖåäö]*$/,
                mentionDenotationChars: ["@"],
                source: async function (searchTerm, renderList, mentionChar) {
                    if (searchTerm.length === 0) {
                        renderList([], searchTerm);
                        return;
                    }
                    try {
                        const { data, error } = await supabase.rpc('search_mentionable_users', {
                            p_search_term: searchTerm,
                            p_current_user_id: currentUser.id
                        });
                        if (error) throw error;
                        
                        const matches = data.map(u => ({
                            id: u.id,
                            value: u.full_name,
                            avatar: u.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}`
                        }));
                        renderList(matches, searchTerm);
                    } catch (e) {
                        renderList([], searchTerm);
                    }
                },
                renderItem: function(item) {
                    return `<div class="flex items-center gap-3">
                                <img src="${item.avatar}" class="w-8 h-8 rounded-full object-cover border border-surface-variant/50">
                                <span class="text-[14px] font-bold text-on-surface dark:text-gray-100">${item.value}</span>
                            </div>`;
                }
            }
        }
    });

    // Submit the comment if the user presses the "Enter" key
    commentQuillEditor.keyboard.addBinding({ key: 'Enter', shiftKey: false }, function() {
        const postId = document.getElementById('send-comment-btn').dataset.postId;
        if (postId) submitComment(postId);
        return false; // Prevent new line
    });
}
function initQuillEditor() {
    // Prevent multiple initializations if the user opens and closes the modal repeatedly
    if (quillEditor) return;
    
    quillEditor = new Quill('#rich-text-editor', {
        theme: 'snow',
        placeholder: 'What\'s on your mind? (@ to mention)',
        modules: {
            // Standard toolbar for main posts
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                ['link'],
                ['clean'] // remove formatting button
            ],
            // Mentions configuration (reusing your existing logic)
            mention: {
                allowedChars: /^[A-Za-z\sÅÄÖåäö]*$/,
                mentionDenotationChars: ["@"],
                source: async function (searchTerm, renderList, mentionChar) {
                    if (searchTerm.length === 0) {
                        renderList([], searchTerm);
                        return;
                    }
                    try {
                        const { data, error } = await supabase.rpc('search_mentionable_users', {
                            p_search_term: searchTerm,
                            p_current_user_id: currentUser.id
                        });
                        if (error) throw error;
                        
                        const matches = data.map(u => ({
                            id: u.id,
                            value: u.full_name,
                            avatar: u.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}`
                        }));
                        renderList(matches, searchTerm);
                    } catch (e) {
                        renderList([], searchTerm);
                    }
                },
                renderItem: function(item) {
                    return `<div class="flex items-center gap-3">
                                <img src="${item.avatar}" class="w-8 h-8 rounded-full object-cover border border-surface-variant/50">
                                <span class="text-[14px] font-bold text-on-surface dark:text-gray-100">${item.value}</span>
                            </div>`;
                }
            }
        }
    });
}
// ========================================================
// PROFESSIONAL SKELETON LOADER
// ========================================================
const FEED_SKELETON = `
    <div class="bg-surface-container-lowest dark:bg-[#1e1e1e] rounded-[32px] p-5 border border-surface-variant/60 dark:border-neutral-800 shadow-sm mb-5 animate-pulse">
        <div class="flex items-center gap-3 mb-4">
            <div class="w-10 h-10 rounded-full bg-surface-variant/50 dark:bg-neutral-800 shrink-0"></div>
            <div class="flex-1">
                <div class="h-3.5 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-1/3 mb-2"></div>
                <div class="h-2.5 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-1/4"></div>
            </div>
        </div>
        <div class="h-3 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-3/4 mb-2"></div>
        <div class="h-3 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-full mb-2"></div>
        <div class="h-3 bg-surface-variant/50 dark:bg-neutral-800 rounded-md w-5/6 mb-4"></div>
        <div class="w-full h-48 bg-surface-variant/50 dark:bg-neutral-800 rounded-2xl mb-4"></div>
        <div class="flex items-center gap-6 border-t border-surface-variant/40 dark:border-neutral-800 pt-3 mt-2">
            <div class="h-5 w-10 bg-surface-variant/50 dark:bg-neutral-800 rounded-md"></div>
            <div class="h-5 w-10 bg-surface-variant/50 dark:bg-neutral-800 rounded-md"></div>
        </div>
    </div>
`.repeat(3);

export function initFeed(user) {
    currentUser = user;
    
    setupCreatePostPermissions();
   refreshMainFeed();
    setupImagePreviews();
setupLikesModalTouchPhysics();
    
  document.addEventListener('openCreatePostView', () => {
        if(currentUser) {
            document.getElementById('create-post-avatar').src = currentUser.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.full_name)}&background=e1e3e4`;
            document.getElementById('create-post-name').innerHTML = `${currentUser.full_name} ${getTickHtml(currentUser.tick_type)}`;
        }
        // Initialize rich text editor when the modal opens
        initQuillEditor();
    });

    // 1. GLOBAL Event Delegation (Listens to the whole body)
    document.body.addEventListener('click', (e) => {
        const likeBtn = e.target.closest('.like-btn');
        const commentBtn = e.target.closest('.comment-btn');
        const pollOption = e.target.closest('.poll-option-btn');
        const profileLink = e.target.closest('.profile-link');
        const optionsBtn = e.target.closest('.post-options-btn');
        const commentOptionsBtn = e.target.closest('.comment-options-btn');
        
        // 🚀 NEW: Catch Mention Clicks
        const mentionLink = e.target.closest('.mention');

        if (likeBtn) handleLike(likeBtn.dataset.postId, likeBtn.dataset.liked === 'true');
        if (commentBtn) openCommentsModal(commentBtn.dataset.postId);
        if (pollOption) handlePollVote(pollOption.dataset.postId, parseInt(pollOption.dataset.optionIndex), pollOption.dataset.isMultiple === 'true');
        if (profileLink) window.viewUserProfile(profileLink.dataset.userId);
        if (optionsBtn) openPostOptions(optionsBtn.dataset.postId, optionsBtn.dataset.userId, optionsBtn.dataset.isVerified === 'true');
        if (commentOptionsBtn) openCommentOptions(commentOptionsBtn.dataset.commentId, commentOptionsBtn.dataset.userId);
        
        // 🚀 NEW: Route mention click to profile
        if (mentionLink && mentionLink.dataset.id) {
            e.preventDefault(); // Stop any default anchor behavior
            window.viewUserProfile(mentionLink.dataset.id);
        }
    });
    
    // 2. Modals and Submissions
    document.getElementById('submit-post-btn')?.addEventListener('click', submitPost);
    document.getElementById('send-comment-btn')?.addEventListener('click', () => {
        submitComment(document.getElementById('send-comment-btn').dataset.postId);
    });
    
    document.getElementById('submit-report-post-btn')?.addEventListener('click', submitPostReport);
    document.getElementById('close-post-comments-btn')?.addEventListener('click', closeCommentsModal);

    // 3. Tab switching in create post modal
    document.querySelectorAll('.post-type-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.post-type-tab').forEach(t => {
                t.classList.remove('bg-primary', 'text-white');
                t.classList.add('bg-surface-variant/50', 'dark:bg-surface-variant/10', 'text-on-surface-variant', 'dark:text-gray-300');
            });
            e.currentTarget.classList.remove('bg-surface-variant/50', 'dark:bg-surface-variant/10', 'text-on-surface-variant', 'dark:text-gray-300');
            e.currentTarget.classList.add('bg-primary', 'text-white');
            
            document.querySelectorAll('.post-input-section').forEach(sec => {
                sec.classList.remove('block');
                sec.classList.add('hidden');
            });
            const targetSection = document.getElementById(`input-${e.currentTarget.dataset.type}`);
            if(targetSection) {
                targetSection.classList.remove('hidden');
                targetSection.classList.add('block');
            }
            document.getElementById('current-post-type').value = e.currentTarget.dataset.type;
        });
    });
}

function getTickHtml(tickType) {
    if (!tickType || tickType.toLowerCase().trim() === 'none') return '';
    
    // 🚀 FIX: Strictly apply the hex code directly to the style
    return `<span class="material-symbols-outlined text-[14px] ml-1" style="color: ${tickType.trim()}; font-variation-settings: 'FILL' 1;">verified</span>`;
}

function setupCreatePostPermissions() {
    if (currentUser?.special_post) {
        document.querySelectorAll('.post-type-tab').forEach(tab => tab.classList.remove('hidden'));
    } else {
        document.querySelectorAll('.post-type-tab:not([data-type="text"])').forEach(tab => tab.classList.add('hidden'));
    }
}

function setupImagePreviews() {
    const attachPreview = (inputId, containerId, iconId, textId) => {
        const input = document.getElementById(inputId);
        const container = document.getElementById(containerId);
        if(!input || !container) return;
        
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    container.innerHTML = `
                        <img src="${event.target.result}" class="w-full h-auto max-h-[60vh] object-contain rounded-xl">
                        <button type="button" class="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors z-10" onclick="event.stopPropagation(); document.getElementById('${inputId}').value=''; document.getElementById('${containerId}').innerHTML='<span class=\\'material-symbols-outlined text-[32px] mb-2\\'>${iconId}</span><span class=\\'text-sm font-medium\\'>${textId}</span>';">
                            <span class="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    `;
                };
                reader.readAsDataURL(file);
            }
        });
    };

    attachPreview('post-image-upload', 'post-image-preview-container', 'add_photo_alternate', 'Tap to upload image');
    attachPreview('event-image-upload', 'event-image-preview-container', 'wallpaper', 'Add Event Cover Photo');
}

async function uploadToCloudinary(file) {
    showToast('Compressing image...', 'info'); 
    
    // Compress down to 1080px width at 70% quality (Massive size reduction!)
    const compressedFile = await compressImage(file, 1080, 0.7);

    const formData = new FormData();
    formData.append('file', compressedFile);
    formData.append('upload_preset', 'ecampus_posts');

    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData,
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data.secure_url;
}

// ==========================================
// POST CREATION (Advanced Relational Logic)
// ==========================================
async function submitPost() {
    const postType = document.getElementById('current-post-type').value;
    
    // Get HTML content from Quill, and plain text just to check if it's empty
    const contentHTML = quillEditor.root.innerHTML;
    const plainText = quillEditor.getText().trim();
    
    if (!plainText && postType === 'text') {
        showToast('Please write something to post.', 'warning');
        return;
    }

    const btn = document.getElementById('submit-post-btn');
    btn.disabled = true;
    btn.textContent = 'Publishing...';

    try {
       // 1. Setup Base Post Payload
        // 🚀 Read from the new hidden inputs instead of selects!
        const expiryDays = parseInt(document.getElementById('post-expiry-value').value) || 7;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);

        const viewersAccess = document.getElementById('post-viewers-value')?.value || 'all';

        // Extract mentioned user IDs from Quill's internal Delta state
        const mentionedIds = [];
        quillEditor.getContents().ops.forEach(op => {
            if (op.insert && op.insert.mention) {
                mentionedIds.push(op.insert.mention.id);
            }
        });

        let basePayload = { 
            user_id: currentUser.id, 
            post_type: postType, 
            content: contentHTML,
            expires_at: expiresAt.toISOString(),
            viewers_access: viewersAccess,
            mentioned_user_ids: mentionedIds
        };

        // Handle Standard Image Upload
        if (postType === 'image') {
            const fileInput = document.getElementById('post-image-upload');
            if (!fileInput.files[0]) throw new Error("Please select an image to upload.");
            basePayload.media_url = await uploadToCloudinary(fileInput.files[0]);
        }

        // 2. Insert into the MAIN `posts` table first to get the ID
        const { data: newPost, error: postError } = await supabase
            .from('posts')
            .insert(basePayload)
            .select('id')
            .single();

        if (postError) throw postError;
        const newPostId = newPost.id;

        // 3. Handle specific Sub-Tables (Polls or Events)
        if (postType === 'poll') {
            const inputs = document.querySelectorAll('.poll-opt-input');
            const rawOptions = Array.from(inputs).map(inp => inp.value.trim()).filter(val => val !== '');
            if(rawOptions.length < 2) throw new Error("Polls need at least 2 options.");
            
            // Format options for the JSONB column: [{"id": "1", "text": "Apple"}, ...]
            const formattedOptions = rawOptions.map((opt, index) => ({
                id: (index + 1).toString(),
                text: opt
            }));

            const pollPayload = {
                post_id: newPostId,
                options: formattedOptions,
                is_multiple_choice: document.getElementById('poll-is-multiple').checked,
                can_undo_vote: document.getElementById('poll-can-undo').checked,
                voters_list_visibility: document.getElementById('poll-voters-visibility').value,
                deadline_type: document.getElementById('poll-deadline-type').value
            };

            if (pollPayload.deadline_type === 'voter_count') {
                const countVal = parseInt(document.getElementById('poll-deadline-count').value);
                if (!countVal || countVal < 1) throw new Error("Please enter a valid target vote count.");
                pollPayload.deadline_count = countVal;
            }

            const { error: pollError } = await supabase.from('post_polls').insert(pollPayload);
            if (pollError) throw pollError;
        } 
        
        else if (postType === 'event') {
            const dateVal = document.getElementById('event-date').value;
            if (!dateVal) throw new Error("Please select an event date and time.");

            const eventPayload = {
                post_id: newPostId,
                event_date: new Date(dateVal).toISOString(),
                event_location: document.getElementById('event-location').value.trim() || null,
                enable_rsvp: document.getElementById('event-enable-rsvp').checked,
                rsvp_list_visibility: document.getElementById('event-rsvp-visibility').value,
                show_register_btn: document.getElementById('event-show-register').checked,
                register_url: document.getElementById('event-register-url').value.trim() || null
            };

            const fileInput = document.getElementById('event-image-upload');
            if (fileInput.files[0]) {
                eventPayload.event_image_url = await uploadToCloudinary(fileInput.files[0]);
            }

            const { error: eventError } = await supabase.from('post_events').insert(eventPayload);
            if (eventError) throw eventError;
        }

        // Mass-Notify Followers if it's an Official Page
        if (currentUser.role === 'page') {
            await supabase.rpc('notify_page_followers', {
                p_page_id: currentUser.id,
                p_type: 'page_new_post',
                p_message: 'published a new post.',
                p_target_id: newPostId
            });
        }

        // 4. Clean up UI & Reset
        window.closeCreatePostView();
        quillEditor.setContents([]); // Clear Rich Text Editor
        if (document.getElementById('post-image-upload')) document.getElementById('post-image-upload').value = '';
        if (document.getElementById('event-image-upload')) document.getElementById('event-image-upload').value = '';
        
        showToast('Post published successfully!', 'success');
        
        // Refresh feed to show new post
        window.refreshMainFeed();

    } catch (error) {
        showToast(error.message || 'Failed to create post.', 'error');
        console.error('Error submitting post:', error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Publish';
    }
}
// ==========================================
// FETCHING & RENDERING POSTS
// ==========================================

// ==========================================
// INFINITE SCROLL & PAGINATION ENGINE
// ==========================================
let currentFeedPage = 0;
const POSTS_PER_PAGE = 7; // Optimized for mobile viewport
let isFetchingFeed = false;
let hasMorePosts = true;

window.refreshMainFeed = async function() {
    currentFeedPage = 0;
    hasMorePosts = true;
    document.getElementById('feed-posts-container').innerHTML = FEED_SKELETON;
    await fetchPosts(true);
};

// ==========================================
// FETCHING POSTS (Relational Engine)
// ==========================================
async function fetchPosts(isRefresh = false) {
    if (isFetchingFeed || (!hasMorePosts && !isRefresh)) return;
    isFetchingFeed = true;

    const from = currentFeedPage * POSTS_PER_PAGE;
    const to = from + POSTS_PER_PAGE - 1;

    try {
        const blockedIds = await window.getBlockedUserIds(currentUser.id);

        // Huge nested select to grab metadata, polls, events, and votes in one go
       let query = supabase
            .from('posts')
            .select(`
                *,
                users!inner(id, full_name, profile_img_url, tick_type, role, is_deleted, is_deactivated),
                post_likes(user_id, users(full_name)),
                post_comments(id, content, created_at, users(full_name)),
                post_polls(*),
                post_poll_votes(user_id, option_id),
                post_events(*),
                post_event_rsvps(user_id, status)
            `)
            .eq('is_deleted', false) 
            .eq('users.is_deleted', false)
            .eq('users.is_deactivated', false)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (blockedIds.length > 0) {
            query = query.not('user_id', 'in', `(${blockedIds.join(',')})`);
        }

        const { data, error } = await query;

        if (error) throw error;

        if (data.length < POSTS_PER_PAGE) {
            hasMorePosts = false;
        }

        const oldSentinel = document.getElementById('feed-bottom-sentinel');
        if (oldSentinel) oldSentinel.remove();

        renderPosts(data, isRefresh);
        currentFeedPage++;
        
        if (hasMorePosts) {
            setupIntersectionObserver();
        }

    } catch (error) {
        console.error('Error fetching posts:', error);
        if (isRefresh) document.getElementById('feed-posts-container').innerHTML = `<p class="text-center py-10 text-error">Failed to load feed.</p>`;
    } finally {
        isFetchingFeed = false;
    }
}

function setupIntersectionObserver() {
    const container = document.getElementById('feed-posts-container');
    
    // Remove old sentinel
    let sentinel = document.getElementById('feed-bottom-sentinel');
    if (sentinel) sentinel.remove();

    // Create new sentinel loader
    sentinel = document.createElement('div');
    sentinel.id = 'feed-bottom-sentinel';
    sentinel.className = 'w-full py-8 flex justify-center';
    sentinel.innerHTML = `<span class="material-symbols-outlined animate-spin text-primary text-[28px]">progress_activity</span>`;
    container.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            observer.disconnect(); // Stop observing old sentinel
            fetchPosts(false); // Fetch next page!
        }
    }, { rootMargin: '400px' }); // Start fetching 400px BEFORE they hit the bottom

    observer.observe(sentinel);
}

function renderPosts(posts, isRefresh = false) {
    const container = document.getElementById('feed-posts-container');
    
    if (posts.length === 0 && isRefresh) {
        container.innerHTML = `<div class="py-12 flex flex-col items-center justify-center opacity-40"><span class="material-symbols-outlined text-[42px] mb-2">photo_camera</span><p class="text-sm font-medium text-on-surface-variant">The feed is empty.</p></div>`;
        return;
    }

    const htmlString = posts.map(post => {
        const user = post.users;
        if (!user) return '';

        // --- 1. LIKES LOGIC ---
        const likes = post.post_likes || [];
        const likeCount = likes.length;
        const userHasLiked = likes.some(like => like.user_id === currentUser.id);
        
        let likedByHtml = '';
        if (likeCount > 0) {
            // Find a liker to feature (preferring someone other than the current user if possible)
            const featuredLiker = likes.find(l => l.user_id !== currentUser.id)?.users?.full_name || likes[0]?.users?.full_name || 'Someone';
            
            if (likeCount === 1) {
                likedByHtml = `Liked by <span class="font-bold text-on-surface dark:text-gray-100">${featuredLiker}</span>`;
            } else {
                likedByHtml = `Liked by <span class="font-bold text-on-surface dark:text-gray-100">${featuredLiker}</span> and <span onclick="window.openLikesModal('${post.id}')" class="font-bold text-on-surface dark:text-gray-100 cursor-pointer">others</span>`;
            }
        }

        // --- 2. COMMENTS PREVIEW LOGIC ---
        const comments = post.post_comments || [];
        const commentCount = comments.length;
        let commentsHtml = '';
        if (commentCount > 0) {
            const previewCount = commentCount > 1 ? `View all ${commentCount} comments` : 'View 1 comment';
            commentsHtml = `<p data-post-id="${post.id}" class="comment-btn text-[14px] text-on-surface-variant dark:text-gray-400 mt-1 cursor-pointer active:opacity-70">${previewCount}</p>`;
            
            // Show the 1 most recent comment inline
            const latestComment = comments[comments.length - 1];
            if (latestComment) {
                // Strip HTML tags in case there's old Quill formatting in the DB
                const cleanComment = latestComment.content.replace(/<[^>]*>?/gm, '');
                commentsHtml += `<p class="text-[14px] text-on-surface dark:text-gray-100 mt-1 leading-snug"><span class="font-bold mr-1 cursor-pointer">${latestComment.users?.full_name || 'User'}</span><span class="text-on-surface-variant dark:text-gray-300">${cleanComment}</span></p>`;
            }
        }

        // --- 3. USER HEADER ---
        const verifiedBadge = typeof getTickHtml === 'function' ? getTickHtml(user.tick_type) : '';
        const rawAvatarUrl = user.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.full_name)}&background=e1e3e4`;
        const optimizedAvatar = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(rawAvatarUrl, 'avatar') : rawAvatarUrl;
        const headerIcon = `<img loading="lazy" src="${optimizedAvatar}" data-user-id="${user.id}" class="profile-link w-8 h-8 rounded-full border border-surface-variant shadow-sm object-cover cursor-pointer hover:opacity-80 transition-opacity shrink-0">`;

        // --- 4. MEDIA / CONTENT HTML LOGIC ---
        let contentHtml = '';
        
        if (post.post_type === 'image') {
            const optimizedMedia = typeof optimizeImageUrl === 'function' ? optimizeImageUrl(post.media_url, 'feed') : post.media_url;
            contentHtml = `
                <div class="w-full bg-surface-variant/20 dark:bg-neutral-900 flex items-center justify-center border-y border-surface-variant/40 dark:border-neutral-800">
                    <img loading="lazy" src="${optimizedMedia}" class="w-full h-auto max-h-[80vh] object-cover">
                </div>
            `;
        }
        else if (post.post_type === 'event') {
            const event = post.post_events && post.post_events.length > 0 ? post.post_events[0] : null;
            if (event) {
                const optimizedEventMedia = typeof optimizeImageUrl === 'function' && event.event_image_url ? optimizeImageUrl(event.event_image_url, 'feed') : event.event_image_url;
                const eventImgHtml = event.event_image_url ? `<img loading="lazy" src="${optimizedEventMedia}" class="w-full h-auto max-h-[80vh] object-cover border-y border-surface-variant/40 dark:border-neutral-800">` : '';
                const dateStr = event.event_date ? new Date(event.event_date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'TBA';
                
                let actionHtml = '';
                if (event.show_register_btn && event.register_url) {
                    actionHtml = `<a href="${event.register_url}" target="_blank" class="block w-full mt-3 bg-secondary text-white text-center py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-transform">View Link</a>`;
                } else if (event.enable_rsvp) {
                    const rsvps = post.post_event_rsvps || [];
                    const isAttending = !!rsvps.find(r => r.user_id === currentUser.id);
                    const btnClass = isAttending ? 'bg-surface-variant/50 text-on-surface dark:text-gray-100' : 'bg-primary text-white';
                    const btnText = isAttending ? '✓ Attending' : 'RSVP Now';
                    actionHtml = `<button onclick="window.handleRSVP('${post.id}', ${isAttending})" class="block w-full mt-3 ${btnClass} text-center py-2 rounded-xl text-[13px] font-bold active:scale-95 transition-all">${btnText}</button>`;
                }

                contentHtml = `
                    ${eventImgHtml}
                    <div class="px-3 py-3 bg-secondary/5 border-b border-secondary/20 dark:border-neutral-800">
                        <div class="bg-secondary/10 text-secondary w-max px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest mb-2">Upcoming Event</div>
                        <div class="space-y-1">
                            <p class="text-[13px] text-on-surface-variant dark:text-gray-300 flex items-center gap-2 font-medium">
                                <span class="material-symbols-outlined text-[16px]">calendar_today</span> ${dateStr}
                            </p>
                            ${event.event_location ? `<p class="text-[13px] text-on-surface-variant dark:text-gray-300 flex items-center gap-2 font-medium"><span class="material-symbols-outlined text-[16px]">location_on</span> ${event.event_location}</p>` : ''}
                        </div>
                        ${actionHtml}
                    </div>
                `;
            }
        }
        else if (post.post_type === 'poll') {
            const poll = post.post_polls && post.post_polls.length > 0 ? post.post_polls[0] : null;
            if (poll) {
                const votes = post.post_poll_votes || [];
                const totalVotes = votes.length;
                const myVotes = votes.filter(v => v.user_id === currentUser.id).map(v => v.option_id);
                const userHasVoted = myVotes.length > 0;
                
                const postExpired = new Date(post.expires_at) < new Date();
                const isEnded = postExpired || poll.is_ended_early;
                const showResults = userHasVoted || isEnded || poll.voters_list_visibility === 'public';

                const optionsHtml = (poll.options || []).map((opt) => {
                    const optVotes = votes.filter(v => v.option_id === opt.id).length;
                    const percentage = totalVotes === 0 ? 0 : Math.round((optVotes / totalVotes) * 100);
                    const iVotedForThis = myVotes.includes(opt.id);
                    const isClickable = !isEnded && (!userHasVoted || poll.can_undo_vote || poll.is_multiple_choice);
                    
                    return `
                    <div onclick="${isClickable ? `window.handlePollVote('${post.id}', '${opt.id}', ${iVotedForThis})` : ''}" 
                         class="poll-option-btn ${isClickable ? 'cursor-pointer active:scale-[0.98]' : 'cursor-default'} relative w-full bg-surface-variant/30 dark:bg-surface-variant/10 border border-surface-variant/50 dark:border-neutral-700 rounded-xl p-3 overflow-hidden transition-all mb-2">
                        <div class="poll-progress-bar absolute left-0 top-0 bottom-0 bg-primary/20 rounded-r-xl transition-all duration-700 ease-out" style="width: ${showResults ? percentage : 0}%"></div>
                        <div class="relative flex justify-between items-center text-[13px] font-bold text-on-surface dark:text-gray-100 z-10">
                            <span class="flex items-center gap-2">
                                <span class="poll-check-circle w-4 h-4 rounded-full border-2 ${iVotedForThis ? 'border-primary flex items-center justify-center' : 'border-surface-variant/80'}">
                                    ${iVotedForThis ? '<span class="w-2 h-2 rounded-full bg-primary"></span>' : ''}
                                </span>
                                ${opt.text}
                            </span>
                            <span class="poll-percentage ${showResults ? 'opacity-100' : 'opacity-0'} transition-opacity">${percentage}%</span>
                        </div>
                    </div>`;
                }).join('');

                contentHtml = `
                    <div class="px-3 py-3 border-y border-surface-variant/40 dark:border-neutral-800 bg-surface-variant/5 dark:bg-neutral-900/30">
                        <div class="poll-options-wrapper space-y-2 mb-2">${optionsHtml}</div>
                        <div class="flex justify-between text-[11px] font-medium text-on-surface-variant dark:text-gray-400">
                            <span><span class="poll-total-votes">${totalVotes}</span> votes</span>
                            <span>${isEnded ? 'Ended' : `Ends ${timeAgo(post.expires_at)}`}</span>
                        </div>
                    </div>
                `;
            }
        }

        // Clean caption HTML logic (Removes Quill <p> wrappers so it displays inline)
        let captionHtml = '';
        if (post.content && post.content.trim() !== '' && post.content !== '<p><br></p>') {
            const cleanContent = post.content.replace(/<p>/g, '').replace(/<\/p>/g, '<br>').replace(/^(<br>)+|(<br>)+$/g, '').trim();
            if (cleanContent !== '') {
                captionHtml = `
                <div class="px-3 text-[14px] text-on-surface dark:text-gray-100 leading-snug mt-1">
                    <span data-user-id="${user.id}" class="profile-link font-bold mr-1 cursor-pointer hover:underline">${user.full_name}</span>
                    <span class="rich-text-content inline">${cleanContent}</span>
                </div>`;
            }
        }

        // --- 5. MAIN CARD HTML ---
        return `
        <div data-post-id="${post.id}" class="bg-surface dark:bg-[#121212] mb-6 animate-fadeIn pb-4 border-b border-surface-variant/40 dark:border-neutral-800 relative">
            
            ${post.is_verified ? '<div class="absolute top-3 right-3 bg-[#e8b339] text-white px-2 py-0.5 rounded text-[9px] font-extrabold uppercase shadow-sm z-10"><span class="material-symbols-outlined text-[12px] align-middle">stars</span> Verified</div>' : ''}

            <!-- HEADER -->
            <div class="flex items-center gap-3 px-3 py-3">
                ${headerIcon}
                <div class="flex-1 min-w-0">
                    <h4 data-user-id="${user.id}" class="profile-link font-bold text-[14px] text-on-surface dark:text-gray-100 leading-tight cursor-pointer hover:text-primary transition-colors flex items-center gap-1 truncate">
                        ${user.full_name} ${verifiedBadge}
                    </h4>
                    ${post.post_events && post.post_events.length > 0 && post.post_events[0].event_location ? `<p class="text-[11px] text-on-surface-variant dark:text-gray-400 mt-0.5 truncate">${post.post_events[0].event_location}</p>` : ''}
                </div>
                <button data-post-id="${post.id}" data-user-id="${user.id}" data-is-verified="${post.is_verified}" class="post-options-btn text-on-surface dark:text-gray-100 p-1.5 active:opacity-60 transition-opacity">
                    <span class="material-symbols-outlined text-[20px]">more_vert</span>
                </button>
            </div>
            
            <!-- EDGE-TO-EDGE MEDIA / CONTENT -->
            ${contentHtml}
            
            <!-- ACTION BAR -->
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
            
            <!-- LIKES TEXT -->
            ${likeCount > 0 ? `<div class="px-3 mb-1 text-[14px] text-on-surface dark:text-gray-100">${likedByHtml}</div>` : ''}
            
            <!-- CAPTION -->
            ${captionHtml}
            
            <!-- COMMENTS PREVIEW -->
            <div class="px-3 mt-1">
                ${commentsHtml}
            </div>

            <!-- ADD COMMENT INLINE INPUT (Visual Trigger) -->
            <div class="px-3 mt-2 flex items-center gap-2">
                <img src="${currentUser?.profile_img_url || 'https://ui-avatars.com/api/?name=User'}" class="w-6 h-6 rounded-full object-cover border border-surface-variant/50">
                <p data-post-id="${post.id}" class="comment-btn flex-1 text-[13px] text-on-surface-variant dark:text-gray-500 cursor-text">Add a comment...</p>
            </div>

            <!-- TIMESTAMP -->
            <p class="px-3 text-[11px] text-on-surface-variant dark:text-gray-500 mt-2 uppercase tracking-wide">${timeAgo(post.created_at)}</p>
        </div>
        `;
    }).join('');

    if (isRefresh) container.innerHTML = htmlString;
    else container.insertAdjacentHTML('beforeend', htmlString);
}

// ==========================================
// OPTIMISTIC LIKE ENGINE (Global & Failsafe)
// ==========================================
window.handleLike = async function(postId, btnElement) {
    if (!currentUser) return; 
    
    // Read current state directly from the button that was clicked
    const isLiked = btnElement.dataset.liked === 'true';
    const nextLikedState = !isLiked;

    // 1. OPTIMISTIC UI: Instantly update everywhere
    const likeBtns = document.querySelectorAll(`.like-btn[data-post-id="${postId}"]`);
    
    likeBtns.forEach(likeBtn => {
        likeBtn.dataset.liked = nextLikedState.toString();

        // Safely find the elements
        const container = likeBtn.parentElement; 
        const countSpan = container ? container.querySelector('.like-count-text') : null;
        const iconSpan = likeBtn.querySelector('.material-symbols-outlined');
        
        // Update Number instantly
        if (countSpan) {
            let currentCount = parseInt(countSpan.textContent.trim()) || 0;
            countSpan.textContent = nextLikedState ? currentCount + 1 : Math.max(0, currentCount - 1);
        }
        
        // Update Heart Icon instantly (Overwrites classes to prevent CSS conflicts)
        if (iconSpan) {
            if (nextLikedState) {
                likeBtn.className = "like-btn flex items-center justify-center transition-colors active:scale-95 text-red-500";
                iconSpan.classList.add('animate-[pulse_0.3s_ease-out]');
            } else {
                likeBtn.className = "like-btn flex items-center justify-center transition-colors active:scale-95 text-on-surface-variant dark:text-gray-400 hover:text-red-500";
                iconSpan.classList.remove('animate-[pulse_0.3s_ease-out]');
            }
            iconSpan.style.fontVariationSettings = `'FILL' ${nextLikedState ? 1 : 0}`;
        }
    });

    try {
        // 2. BACKGROUND SYNC (Talk to database silently)
        if (!nextLikedState) {
            await supabase.from('post_likes').delete().match({ post_id: postId, user_id: currentUser.id });
        } else {
            await supabase.from('post_likes').insert({ post_id: postId, user_id: currentUser.id });
            
            // Trigger Notification silently
            const { data: postData } = await supabase.from('posts').select('user_id').eq('id', postId).single();
            if (postData && postData.user_id !== currentUser.id) {
                await supabase.from('notifications').insert({
                    user_id: postData.user_id,
                    sender_id: currentUser.id,
                    type: 'post_like',
                    target_id: postId
                });
            }
        }
    } catch (error) {
        console.error("Like error:", error);
    }
};

// ==========================================
// SECURE RPC POLL VOTING
// ==========================================
window.handlePollVote = async function(postId, optionId, isUndo) {
    if (isVoting) return; 
    isVoting = true;
    
    // Optimistic lock visually
    const postEl = document.querySelector(`div[data-post-id="${postId}"]`);
    if (postEl) postEl.style.opacity = '0.6';

    try {
        const { error } = await supabase.rpc('cast_poll_vote', {
            p_post_id: postId,
            p_option_id: optionId,
            p_is_undo: isUndo
        });

        if (error) {
            showToast(error.message, 'error');
            throw error;
        }

        // Hard reload this specific post via fetch to get the fresh accurate data
        // For a production app you'd strictly update the DOM optimistically,
        // but for safety with single/multi choices, refetching the single post ensures sync.
        if (typeof window.refreshMainFeed === 'function') {
            // Small background refresh of the feed to true-up data
            await window.refreshMainFeed(); 
        }

    } catch (error) {
        console.error("Poll vote error:", error);
    } finally {
        if (postEl) postEl.style.opacity = '1';
        isVoting = false; 
    }
}

function updatePollDOM(postId, votes) {
    const postEls = document.querySelectorAll(`div[data-post-id="${postId}"]`);
    if (!postEls || postEls.length === 0) return;
    
    postEls.forEach(postEl => {
        const options = postEl.querySelectorAll('.poll-option-btn');
        const totalVotes = votes.length;
        const myVotes = votes.filter(v => v.user_id === currentUser.id).map(v => v.option_index);
        const userHasVoted = myVotes.length > 0;
        
        const voteCounts = [];
        options.forEach((opt, idx) => {
            voteCounts.push(votes.filter(v => v.option_index === idx).length);
        });

        options.forEach((opt, idx) => {
            const count = voteCounts[idx];
            const percentage = totalVotes === 0 ? 0 : Math.round((count / totalVotes) * 100);
            const iVotedForThis = myVotes.includes(idx);
            
            const bar = opt.querySelector('.poll-progress-bar');
            if (bar) bar.style.width = `${userHasVoted ? percentage : 0}%`;
            
            const circle = opt.querySelector('.poll-check-circle');
            if (circle) {
                if (iVotedForThis) {
                    circle.className = 'poll-check-circle w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center';
                    circle.innerHTML = '<span class="w-2 h-2 rounded-full bg-primary"></span>';
                } else {
                    circle.className = 'poll-check-circle w-4 h-4 rounded-full border-2 border-surface-variant/80 dark:border-gray-500';
                    circle.innerHTML = '';
                }
            }
            
            const percSpan = opt.querySelector('.poll-percentage');
            if (percSpan) {
                percSpan.textContent = `${percentage}%`;
                percSpan.className = `poll-percentage ${userHasVoted ? 'opacity-100' : 'opacity-0'} transition-opacity`;
            }
        });
        
        const votesCountSpan = postEl.querySelector('.poll-total-votes');
        if (votesCountSpan) votesCountSpan.textContent = totalVotes;
    });
}

// Fetch and display voters for public polls
window.openPollVoters = async (postId, optionIndex) => {
    const modal = document.getElementById('modal-poll-voters');
    const list = document.getElementById('poll-voters-list');
    if (!modal || !list) return;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading voters...</p>`;

    try {
        const { data, error } = await supabase
            .from('post_poll_votes')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId)
            .eq('option_index', optionIndex);

        if (error) throw error;
        if (data.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No votes yet.</p>`;
            return;
        }

        list.innerHTML = data.map(v => `
            <div class="flex items-center gap-3 p-3 bg-surface-variant/10 dark:bg-neutral-800 rounded-2xl border border-surface-variant/30 dark:border-neutral-700">
                <img onclick="window.viewUserProfile('${v.users.id}')" src="${v.users.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.users.full_name)}`}" class="w-10 h-10 rounded-full object-cover cursor-pointer">
                <p onclick="window.viewUserProfile('${v.users.id}')" class="font-bold text-sm text-on-surface dark:text-gray-100 flex items-center gap-1 cursor-pointer hover:text-primary transition-colors">${v.users.full_name} ${getTickHtml(v.users.tick_type)}</p>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load voters.</p>`;
        console.error("Voters load error:", e);
    }
};

// ==========================================
// ACTION SHEETS & SOFT DELETES 
// ==========================================
function openPostOptions(postId, postOwnerId, isVerified) {
    const isOwner = currentUser.id === postOwnerId;
    let buttonsHtml = '';

    if (isOwner) {
        buttonsHtml = `
            <button onclick="deletePost('${postId}')" class="w-full flex items-center gap-3 p-4 bg-error/10 text-error rounded-2xl font-bold active:scale-95 transition-transform">
                <span class="material-symbols-outlined">delete</span> Delete Post
            </button>
        `;
    } else {
        if (isVerified) {
            buttonsHtml = `<p class="text-sm text-center text-on-surface-variant font-medium py-4">Official Verified Posts cannot be reported.</p>`;
        } else {
            buttonsHtml = `
                <button onclick="openReportPostModal('${postId}')" class="w-full flex items-center gap-3 p-4 bg-orange-500/10 text-orange-500 rounded-2xl font-bold active:scale-95 transition-transform">
                    <span class="material-symbols-outlined">flag</span> Report Post
                </button>
            `;
        }
    }

    window.openActionSheet(buttonsHtml);
}

function openCommentOptions(commentId, commentOwnerId) {
    const isOwner = currentUser.id === commentOwnerId;
    let buttonsHtml = '';

    if (isOwner) {
        buttonsHtml = `
            <button onclick="deleteComment('${commentId}')" class="w-full flex items-center gap-3 p-4 bg-error/10 text-error rounded-2xl font-bold active:scale-95 transition-transform">
                <span class="material-symbols-outlined">delete</span> Delete Comment
            </button>
        `;
    } else {
        buttonsHtml = `<p class="text-sm text-center text-on-surface-variant">No actions available.</p>`;
    }

    window.openActionSheet(buttonsHtml);
}

window.deletePost = function(postId) {
    // 1. Close the action sheet
    if (typeof closeActionSheet === 'function') closeActionSheet();

    // 2. Open the Native Confirmation Modal (This bypasses the mobile block!)
    const modal = document.getElementById('modal-confirm-action');
    if (!modal) return;

    document.getElementById('confirm-action-title').textContent = "Delete Post?";
    document.getElementById('confirm-action-message').textContent = "This will permanently remove this post from your feed and profile.";

    modal.classList.replace('hidden', 'flex');

    const confirmBtn = document.getElementById('confirm-action-yes');
    const cancelBtn = document.getElementById('confirm-action-no');

    // Clone buttons to safely clear any old event listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    // 3. Handle the Cancel Button
    newCancelBtn.addEventListener('click', () => {
        modal.classList.replace('flex', 'hidden');
    });

    // 4. Handle the Confirm Button (Executes the deletion)
    newConfirmBtn.addEventListener('click', async () => {
        modal.classList.replace('flex', 'hidden');
        showToast('Deleting post...', 'info');

        // Optimistic UI: Hide the post from the screen instantly for a snappy feel
        const postElements = document.querySelectorAll(`div[data-post-id="${postId}"]`);
        postElements.forEach(el => el.style.display = 'none');

        // Hit the database
        const { error } = await supabase.from('posts').update({ is_deleted: true }).eq('id', postId);

        if (error) {
            console.error('Supabase Delete Error:', error);
            // Revert the optimistic hide if the database fails
            postElements.forEach(el => el.style.display = 'block'); 
            showToast('Failed to delete post.', 'error');
        } else {
            showToast('Post deleted.', 'success');
            // Destroy the HTML elements completely
            postElements.forEach(el => el.remove()); 
        }
    });
};

window.deleteComment = async (commentId) => {
    window.closeActionSheet();
    const { error } = await supabase.from('post_comments').update({ is_deleted: true }).eq('id', commentId);
    
    if (error) {
        showToast('Failed to delete comment.', 'error');
    } else {
        showToast('Comment deleted.', 'success');
        closeCommentsModal();
    }
};

window.openReportPostModal = (postId) => {
    window.closeActionSheet();
    const modal = document.getElementById('modal-report-post');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.getElementById('submit-report-post-btn').dataset.postId = postId;
};

window.closeReportPostModal = () => {
    const modal = document.getElementById('modal-report-post');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    document.getElementById('report-post-reason').value = '';
    document.getElementById('report-post-description').value = '';
};

async function submitPostReport() {
    const btn = document.getElementById('submit-report-post-btn');
    const postId = btn.dataset.postId;
    const reason = document.getElementById('report-post-reason').value;
    const desc = document.getElementById('report-post-description').value.trim();

    if (!reason) {
        showToast('Please select a reason.', 'warning');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        const { error } = await supabase.rpc('report_post', {
            p_reported_post_id: postId,
            p_reason: reason,
            p_description: desc || null
        });
        if (error) throw error;
        
        showToast('Report submitted. Our team will review it.', 'success');
        window.closeReportPostModal();
    } catch (error) {
        showToast(error.message || 'Failed to submit report.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Report';
    }
}

// ==========================================
// COMMENTS 
// ==========================================
// ==========================================
// NATIVE COMMENTS, REPLIES & MENTIONS
// ==========================================
let activeReplyCommentId = null;
let currentMentionIds = [];

window.cancelReply = function() {
    activeReplyCommentId = null;
    document.getElementById('replying-to-indicator').classList.add('hidden');
    document.getElementById('post-comment-input').focus();
};

window.prepareReply = function(commentId, userName) {
    activeReplyCommentId = commentId;
    document.getElementById('replying-to-name').textContent = userName;
    document.getElementById('replying-to-indicator').classList.remove('hidden');
    
    const input = document.getElementById('post-comment-input');
    input.value = `@${userName} `; // Auto-tag the person
    input.focus();
    document.getElementById('send-comment-btn').disabled = false;
};

// Auto-resize textarea & enable Post button
document.getElementById('post-comment-input')?.addEventListener('input', function(e) {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    
    document.getElementById('send-comment-btn').disabled = this.value.trim() === '';
    handleNativeMentions(this.value, this);
});

// NATIVE MENTIONS ENGINE
async function handleNativeMentions(text, inputElement) {
    const list = document.getElementById('comment-mention-list');
    const match = text.match(/@([a-zA-Z0-9_]+)$/); // Detect typing @something at the end
    
    if (match) {
        const query = match[1];
        list.classList.remove('hidden');
        list.innerHTML = `<p class="text-xs text-center py-2 text-gray-500">Searching...</p>`;
        
        try {
            const { data, error } = await supabase.rpc('search_mentionable_users', {
                p_search_term: query,
                p_current_user_id: currentUser.id
            });
            if (error) throw error;
            
            if (data.length === 0) {
                list.innerHTML = `<p class="text-xs text-center py-2 text-gray-500">No users found</p>`;
                return;
            }
            
            list.innerHTML = data.map(u => `
                <div onclick="window.insertMention('${u.id}', '${u.full_name}')" class="flex items-center gap-3 p-3 hover:bg-surface-variant/30 cursor-pointer transition-colors active:scale-[0.98]">
                    <img src="${u.profile_img_url}" class="w-8 h-8 rounded-full object-cover">
                    <span class="text-[13px] font-bold text-on-surface dark:text-gray-100">${u.full_name}</span>
                </div>
            `).join('');
        } catch (e) {
            list.classList.add('hidden');
        }
    } else {
        list.classList.add('hidden');
    }
}

window.insertMention = function(userId, fullName) {
    const input = document.getElementById('post-comment-input');
    // Replace the incomplete @text with the full name
    input.value = input.value.replace(/@[a-zA-Z0-9_]+$/, `@${fullName} `);
    currentMentionIds.push(userId); // Store ID for backend
    
    document.getElementById('comment-mention-list').classList.add('hidden');
    input.focus();
};

async function openCommentsModal(postId) {
    const modal = document.getElementById('modal-post-comments');
    const list = document.getElementById('post-comments-list');
    const input = document.getElementById('post-comment-input');
    
    document.getElementById('send-comment-btn').dataset.postId = postId;
    window.cancelReply(); // Reset UI
    input.value = '';
    input.style.height = 'auto';
    currentMentionIds = [];

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading comments...</p>`;

    try {
        const { data, error } = await supabase
            .from('post_comments')
            .select('*, users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId)
            .eq('is_deleted', false)
            .order('created_at', { ascending: true });

        if (error) throw error;

        if (data.length === 0) {
            list.innerHTML = `<div class="py-10 flex flex-col items-center opacity-40"><span class="material-symbols-outlined text-[42px] mb-2">chat_bubble</span><p class="text-[14px] font-bold">No comments yet.</p><p class="text-[12px]">Start the conversation.</p></div>`;
            return;
        }

        // Separate parents and replies for 1-level Instagram hierarchy
        const parents = data.filter(c => !c.parent_comment_id);
        const replies = data.filter(c => c.parent_comment_id);

        list.innerHTML = parents.map(comment => {
            const commentReplies = replies.filter(r => r.parent_comment_id === comment.id);
            return renderSingleComment(comment, false) + commentReplies.map(r => renderSingleComment(r, true)).join('');
        }).join('');

        setupCommentSwipePhysics(); // Boot touch physics

    } catch (error) {
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load comments.</p>`;
    }
}

function renderSingleComment(comment, isReply) {
    const isOwner = currentUser.id === comment.user_id;
    const paddingLeft = isReply ? 'ml-12' : ''; // Indent replies
    
    // Highlight @mentions in text
    let formattedContent = comment.content.replace(/@([\w\s]+)(?=\s|$)/g, '<span class="text-primary font-bold">@$1</span>');

    return `
        <div class="comment-swipe-container ${paddingLeft} mb-4 relative" data-comment-id="${comment.id}">
            <!-- Swipe Delete Background -->
            ${isOwner ? `<div class="comment-delete-bg rounded-2xl"><span class="material-symbols-outlined text-white text-[24px]">delete</span></div>` : ''}
            
            <!-- Draggable Foreground -->
            <div class="comment-swipe-track flex items-start gap-3 bg-surface dark:bg-[#1e1e1e] p-1">
                <img onclick="window.viewUserProfile('${comment.users.id}')" src="${comment.users.profile_img_url}" class="w-8 h-8 rounded-full object-cover shrink-0 cursor-pointer mt-1 border border-surface-variant/50">
                <div class="flex-1 min-w-0">
                    <p class="text-[13px] text-on-surface dark:text-gray-100 leading-snug">
                        <span onclick="window.viewUserProfile('${comment.users.id}')" class="font-extrabold mr-1 cursor-pointer hover:underline">${comment.users.full_name}</span>
                        ${formattedContent}
                    </p>
                    <div class="flex items-center gap-4 mt-1">
                        <span class="text-[11px] font-bold text-on-surface-variant dark:text-gray-500">${timeAgo(comment.created_at)}</span>
                        <span onclick="window.prepareReply('${isReply ? comment.parent_comment_id : comment.id}', '${comment.users.full_name}')" class="text-[11px] font-bold text-on-surface-variant dark:text-gray-500 cursor-pointer hover:text-primary transition-colors">Reply</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// SWIPE TO DELETE PHYSICS
function setupCommentSwipePhysics() {
    const containers = document.querySelectorAll('.comment-swipe-container');
    
    containers.forEach(container => {
        const track = container.querySelector('.comment-swipe-track');
        const commentId = container.dataset.commentId;
        const bg = container.querySelector('.comment-delete-bg'); // Only exists if isOwner
        
        if (!bg) return; // Not their comment, disable drag

        let startX = 0;
        let currentTranslate = 0;
        let isDragging = false;
        const threshold = -80; // How far to swipe left to trigger delete

        track.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            isDragging = true;
            track.style.transition = 'none';
        }, { passive: true });

        track.addEventListener('touchmove', e => {
            if (!isDragging) return;
            const deltaX = e.touches[0].clientX - startX;
            if (deltaX < 0) { // Only allow swiping LEFT
                currentTranslate = Math.max(deltaX, -100); // Cap at 100px
                track.style.transform = `translateX(${currentTranslate}px)`;
            }
        }, { passive: false });

        track.addEventListener('touchend', e => {
            isDragging = false;
            track.style.transition = 'transform 0.2s ease-out';
            
            if (currentTranslate < threshold) {
                // Trigger Delete!
                track.style.transform = `translateX(-100vw)`; // slide all the way out
                setTimeout(() => executeCommentDelete(commentId, container), 200);
            } else {
                // Snap back
                track.style.transform = `translateX(0px)`;
                currentTranslate = 0;
            }
        });
    });
}

async function executeCommentDelete(commentId, domElement) {
    // Optimistic UI hide
    domElement.style.display = 'none';
    
    const { error } = await supabase.from('post_comments').update({ is_deleted: true }).eq('id', commentId);
    if (error) {
        domElement.style.display = 'block'; // Revert if fails
        showToast('Failed to delete comment', 'error');
    } else {
        domElement.remove();
        showToast('Comment deleted', 'success');
    }
}

// SUBMIT NATIVE COMMENT
async function submitComment(postId) {
    const input = document.getElementById('post-comment-input');
    const content = input.value.trim();
    if (!content) return;

    const btn = document.getElementById('send-comment-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>`;

    // Send to database
    const payload = {
        post_id: postId,
        user_id: currentUser.id,
        content: content,
        mentioned_user_ids: currentMentionIds
    };
    
    if (activeReplyCommentId) {
        payload.parent_comment_id = activeReplyCommentId;
    }

    const { error } = await supabase.from('post_comments').insert(payload);

    if (error) {
        showToast('Failed to post comment.', 'error');
    } else {
        input.value = '';
        input.style.height = 'auto';
        window.cancelReply();
        currentMentionIds = [];
        
        openCommentsModal(postId); // Refresh comment list
        
        // Optimistically increment comment counter on feed
        const commentBtns = document.querySelectorAll(`.comment-btn[data-post-id="${postId}"]`);
        commentBtns.forEach(commentBtn => {
            const html = commentBtn.innerHTML;
            if (html.includes('View')) {
                // If it's text "View X comments"
                const countMatch = html.match(/\d+/);
                if (countMatch) {
                    commentBtn.innerHTML = `View all ${parseInt(countMatch[0]) + 1} comments`;
                }
            } else {
                // If it's an icon badge inside a card
                const countSpan = commentBtn.nextElementSibling;
                if(countSpan) countSpan.textContent = parseInt(countSpan.textContent || 0) + 1;
            }
        });
    }
    
    btn.disabled = false;
    btn.innerHTML = 'Post';
}

// Make sure your Event Listeners map up to the ID
document.getElementById('send-comment-btn')?.addEventListener('click', () => {
    submitComment(document.getElementById('send-comment-btn').dataset.postId);
});
// ==========================================
// LIKES MODAL TOUCH PHYSICS (Swipe to Close)
// ==========================================
function setupLikesModalTouchPhysics() {
    const card = document.getElementById('likes-modal-card');
    if (!card) return;

    let panelStartY = 0;
    let isDraggingPanel = false;
    let isPanelScrollable = false;

    card.addEventListener('touchstart', (e) => {
        const scrollArea = e.target.closest('.overflow-y-auto');
        
        // If the user has scrolled down the list of names, let them scroll natively
        if (scrollArea && scrollArea.scrollTop > 0) {
            isPanelScrollable = true;
            isDraggingPanel = false;
        } else {
            isPanelScrollable = false;
            panelStartY = e.touches[0].clientY;
            isDraggingPanel = true;
            card.style.transition = 'none'; // Disable transition for 1:1 finger tracking
        }
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        
        const deltaY = e.touches[0].clientY - panelStartY;
        
        // Only allow pulling the card DOWN
        if (deltaY > 0) {
            card.style.transform = `translateY(${deltaY}px)`;
            if (e.cancelable) e.preventDefault(); // Lock the screen behind it
        }
    }, { passive: false });

    card.addEventListener('touchend', (e) => {
        if (isPanelScrollable || !isDraggingPanel) return;
        isDraggingPanel = false;
        
        const deltaY = e.changedTouches[0].clientY - panelStartY;
        card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'; 
        
        // SWIPE DOWN -> Trigger the close function
        if (deltaY > 100) {
            window.closeLikesModal();
        } 
        // SNAP BACK -> Didn't swipe far enough
        else {
            card.style.transform = ''; 
        }
    }, { passive: true });
}

// ========================================================
// INSTAGRAM-STYLE LIKES LIST 
// ========================================================
window.openLikesModal = async function(postId) {
    const modal = document.getElementById('modal-likes-list');
    const card = document.getElementById('likes-modal-card');
    const container = document.getElementById('likes-list-container');
    
    if (!modal) return;

    // 1. Animate Modal In
    modal.classList.replace('hidden', 'flex');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        // 🚀 FIX: Wipe any leftover drag styles to guarantee a clean pop-up
        card.style.transform = ''; 
        card.classList.remove('translate-y-full');
    }, 10);

    // 2. Show Native Shimmer Loader while fetching
    container.innerHTML = `
        <div class="flex items-center gap-3 p-3 animate-pulse">
            <div class="w-11 h-11 rounded-full bg-surface-variant/50 dark:bg-neutral-800 shrink-0"></div>
            <div class="flex-1 space-y-2">
                <div class="h-3.5 bg-surface-variant/50 dark:bg-neutral-800 rounded w-1/3"></div>
                <div class="h-2.5 bg-surface-variant/50 dark:bg-neutral-800 rounded w-1/4"></div>
            </div>
        </div>`.repeat(5);

    try {
        const { data: likes, error } = await supabase
            .from('post_likes')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (likes.length === 0) {
            container.innerHTML = `<div class="py-12 flex flex-col items-center opacity-50"><span class="material-symbols-outlined text-4xl mb-2">favorite</span><p class="text-sm font-bold">No likes yet.</p></div>`;
            return;
        }
const getTick = (type) => {
            if (!type || type.toLowerCase().trim() === 'none') return '';
            
            // 🚀 FIX: Strictly apply the hex code directly to the style
            return `<span class="material-symbols-outlined text-[14px]" style="color: ${type.trim()}; font-variation-settings: 'FILL' 1;">verified</span>`;
        };

        container.innerHTML = likes.map(like => {
            const u = like.users;
            const avatar = u.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.full_name)}&background=e1e3e4`;
            
            return `
                <div class="flex items-center justify-between p-3 hover:bg-surface-variant/20 dark:hover:bg-neutral-800/50 rounded-2xl transition-colors active:scale-[0.98]">
                    <div class="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onclick="closeLikesModal(); setTimeout(() => viewUserProfile('${u.id}'), 200);">
                        <img src="${avatar}" class="w-11 h-11 rounded-full object-cover border border-surface-variant/50 dark:border-neutral-800 shadow-sm shrink-0">
                        <div class="flex-1 min-w-0 truncate">
                            <p class="text-[14.5px] font-extrabold text-on-surface dark:text-gray-100 flex items-center gap-1">${u.full_name} ${getTick(u.tick_type)}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error("Likes fetch error:", err);
        container.innerHTML = `<div class="py-10 text-center text-error text-sm font-bold">Failed to load likes.</div>`;
    }
};

window.closeLikesModal = function() {
    const modal = document.getElementById('modal-likes-list');
    const card = document.getElementById('likes-modal-card');
    
    modal.style.pointerEvents = 'none';
    modal.classList.add('opacity-0');
    
    // 🚀 FIX: Erase the thumb's inline translate values so Tailwind can slide it away
    card.style.transform = ''; 
    card.classList.add('translate-y-full');
    
    setTimeout(() => { 
        modal.classList.replace('flex', 'hidden'); 
        modal.style.pointerEvents = 'auto'; // Reset
    }, 300); 
};
// ==========================================
// VIEWERS: POLLS & EVENTS
// ==========================================
window.openPollVoters = async (postId, optionId) => {
    const modal = document.getElementById('modal-poll-voters');
    const list = document.getElementById('poll-voters-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading voters...</p>`;

    try {
        const { data, error } = await supabase
            .from('post_poll_votes')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId)
            .eq('option_id', optionId);

        if (error) throw error;
        if (data.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No votes yet.</p>`;
            return;
        }

        list.innerHTML = data.map(v => `
            <div class="flex items-center gap-3 p-3 bg-surface-variant/10 dark:bg-neutral-800 rounded-2xl border border-surface-variant/30 dark:border-neutral-700">
                <img onclick="window.viewUserProfile('${v.users.id}')" src="${v.users.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.users.full_name)}`}" class="w-10 h-10 rounded-full object-cover cursor-pointer">
                <p onclick="window.viewUserProfile('${v.users.id}')" class="font-bold text-sm text-on-surface dark:text-gray-100 flex items-center gap-1 cursor-pointer hover:text-primary transition-colors">${v.users.full_name} ${window.getTickHtml ? window.getTickHtml(v.users.tick_type) : ''}</p>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load voters. The list might be hidden by the author.</p>`;
        console.error("Voters load error:", e);
    }
};

window.openEventRsvps = async (postId) => {
    const modal = document.getElementById('modal-event-rsvps');
    const list = document.getElementById('event-rsvps-list');
    if (!modal || !list) return;

    modal.classList.replace('hidden', 'flex');
    list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">Loading RSVPs...</p>`;

    try {
        const { data, error } = await supabase
            .from('post_event_rsvps')
            .select('users(id, full_name, profile_img_url, tick_type)')
            .eq('post_id', postId)
            .eq('status', 'attending');

        if (error) throw error;
        if (data.length === 0) {
            list.innerHTML = `<p class="text-sm italic text-center py-8 text-on-surface-variant dark:text-gray-400">No one has RSVP'd yet.</p>`;
            return;
        }

        list.innerHTML = data.map(v => `
            <div class="flex items-center gap-3 p-3 bg-surface-variant/10 dark:bg-neutral-800 rounded-2xl border border-surface-variant/30 dark:border-neutral-700">
                <img onclick="window.viewUserProfile('${v.users.id}')" src="${v.users.profile_img_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(v.users.full_name)}`}" class="w-10 h-10 rounded-full object-cover cursor-pointer">
                <p onclick="window.viewUserProfile('${v.users.id}')" class="font-bold text-sm text-on-surface dark:text-gray-100 flex items-center gap-1 cursor-pointer hover:text-primary transition-colors">${v.users.full_name} ${window.getTickHtml ? window.getTickHtml(v.users.tick_type) : ''}</p>
            </div>
        `).join('');
    } catch (e) {
        list.innerHTML = `<p class="text-sm italic text-center py-8 text-error">Failed to load RSVPs. The list might be hidden by the author.</p>`;
        console.error("RSVP load error:", e);
    }
};

// ==========================================
// SECURE EVENT RSVP ENGINE
// ==========================================
window.isRsvping = false;

window.handleRSVP = async function(postId, isCurrentlyAttending) {
    if (window.isRsvping) return;
    window.isRsvping = true;
    
    // Optimistic UI lock
    const postEl = document.querySelector(`div[data-post-id="${postId}"]`);
    if (postEl) postEl.style.opacity = '0.6';

    try {
        if (isCurrentlyAttending) {
            // Remove RSVP
            const { error } = await supabase
                .from('post_event_rsvps')
                .delete()
                .match({ post_id: postId, user_id: currentUser.id });
                
            if (error) throw error;
            showToast('RSVP Cancelled', 'info');
            
        } else {
            // Add RSVP
            const { error } = await supabase
                .from('post_event_rsvps')
                .insert({ 
                    post_id: postId, 
                    user_id: currentUser.id, 
                    status: 'attending' 
                });
                
            if (error) throw error;
            showToast('RSVP Confirmed!', 'success');
        }

        // Hard reload the feed to ensure RSVP counts and UI buttons sync perfectly
        if (typeof window.refreshMainFeed === 'function') {
            await window.refreshMainFeed(); 
        }

    } catch (error) {
        console.error('RSVP Error:', error);
        showToast(error.message || 'Failed to update RSVP status', 'error');
    } finally {
        if (postEl) postEl.style.opacity = '1';
        window.isRsvping = false;
    }
};
