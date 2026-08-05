import { supabase } from './supabase.js';
import { showToast } from './ui.js';

let currentUser = null;
let currentImageBlob = null;
let currentSelfieBlob = null; // NEW: Selfie Blob

export function initVerification(profile) {
    currentUser = profile;
    
    const header = document.querySelector('header');
    const nav = document.querySelector('nav');
    const mainContent = document.getElementById('main-content');
    
    if (header) header.style.display = 'none';
    if (nav) nav.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
    
    const view = document.getElementById('view-verification');
    view.classList.remove('hidden');
    view.classList.add('flex');
    
    document.getElementById('verify-name').value = '';
    document.getElementById('verify-student-id').value = '';
    document.getElementById('verify-course').value = '';

    renderState(profile.verification_status);
    
    // NEW: Listeners for both ID and Selfie
    document.getElementById('id-card-upload').addEventListener('change', (e) => handleImagePreview(e, 'id-card-preview-container', 'id'));
    document.getElementById('selfie-upload').addEventListener('change', (e) => handleImagePreview(e, 'selfie-preview-container', 'selfie'));
    document.getElementById('submit-verification-btn').addEventListener('click', submitVerification);
    
    document.querySelectorAll('.verify-signout-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.replace('auth/login.html');
        });
    });
}

function renderState(status) {
    document.getElementById('verify-state-form').classList.add('hidden');
    document.getElementById('verify-state-pending').classList.add('hidden');
    
    if (status === 'unverified' || status === 'rejected') {
        document.getElementById('verify-state-form').classList.remove('hidden');
        document.getElementById('verify-state-form').classList.add('flex');
        if (status === 'rejected') fetchRejectionReason();
    } else if (status === 'pending') {
        document.getElementById('verify-state-pending').classList.remove('hidden');
        document.getElementById('verify-state-pending').classList.add('flex');
    }
}

async function fetchRejectionReason() {
    try {
        const { data } = await supabase.from('student_verifications').select('rejection_reason').eq('user_id', currentUser.id).single();
        if (data && data.rejection_reason) {
            document.getElementById('verify-reject-alert').classList.remove('hidden');
            document.getElementById('verify-reject-reason').textContent = data.rejection_reason;
        }
    } catch (e) { console.error(e); }
}

// NEW: Reusable Image Previewer
function handleImagePreview(e, containerId, type) {
    const file = e.target.files[0];
    if (!file) return;

    const container = document.getElementById(containerId);
    const reader = new FileReader();

    reader.onload = (event) => {
        if (type === 'id') currentImageBlob = file;
        if (type === 'selfie') currentSelfieBlob = file;

        const icon = type === 'id' ? 'add_photo_alternate' : 'face';
        const text = type === 'id' ? 'Tap to upload clear photo' : 'Tap to take a selfie';
        const inputId = type === 'id' ? 'id-card-upload' : 'selfie-upload';

        container.innerHTML = `
            <img src="${event.target.result}" class="w-full h-full object-cover rounded-xl">
            <button type="button" class="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors z-10" onclick="event.stopPropagation(); document.getElementById('${inputId}').value=''; if('${type}' === 'id') currentImageBlob=null; else currentSelfieBlob=null; document.getElementById('${containerId}').innerHTML='<span class=\\'material-symbols-outlined text-[32px] mb-2\\'>${icon}</span><span class=\\'text-sm font-medium\\'>${text}</span>';">
                <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
        `;
    };
    reader.readAsDataURL(file);
}

async function submitVerification() {
    const nameInput = document.getElementById('verify-name');
    const idInput = document.getElementById('verify-student-id');
    const courseInput = document.getElementById('verify-course');
    const imageContainer = document.getElementById('id-card-preview-container');
    const selfieContainer = document.getElementById('selfie-preview-container');

    const legalName = nameInput.value.trim();
    const studentId = idInput.value.trim();
    const course = courseInput.value.trim();
    
    [nameInput, idInput, courseInput, imageContainer, selfieContainer].forEach(el => el.classList.remove('border-error', 'dark:border-error'));

    let hasError = false;
    if (!legalName) { nameInput.classList.add('border-error', 'dark:border-error'); hasError = true; }
    if (!studentId) { idInput.classList.add('border-error', 'dark:border-error'); hasError = true; }
    if (!course) { courseInput.classList.add('border-error', 'dark:border-error'); hasError = true; }
    
    if (hasError) return showToast('Please fill out all highlighted text fields.', 'error');

    if (!currentImageBlob) {
        imageContainer.classList.add('border-error', 'dark:border-error');
        return showToast('Please upload a photo of your College ID.', 'error');
    }
    if (!currentSelfieBlob) {
        selfieContainer.classList.add('border-error', 'dark:border-error');
        return showToast('Please take a live selfie.', 'error');
    }

    const btn = document.getElementById('submit-verification-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[24px]">progress_activity</span>`;

    try {
        // Compress both images
        const compressedId = typeof window.compressImage === 'function' ? await window.compressImage(currentImageBlob, 1080, 0.7) : currentImageBlob;
        const compressedSelfie = typeof window.compressImage === 'function' ? await window.compressImage(currentSelfieBlob, 1080, 0.7) : currentSelfieBlob;
        
        // Upload ID Card
        const idFileName = `${currentUser.id}_id_${Date.now()}.${compressedId.name.split('.').pop()}`;
        const { error: idUploadError } = await supabase.storage.from('verifications').upload(idFileName, compressedId, { upsert: true });
        if (idUploadError) throw new Error(`ID Upload Failed: ${idUploadError.message}`);
        const idUrl = supabase.storage.from('verifications').getPublicUrl(idFileName).data.publicUrl;

        // Upload Selfie
        const selfieFileName = `${currentUser.id}_selfie_${Date.now()}.${compressedSelfie.name.split('.').pop()}`;
        const { error: selfieUploadError } = await supabase.storage.from('verifications').upload(selfieFileName, compressedSelfie, { upsert: true });
        if (selfieUploadError) throw new Error(`Selfie Upload Failed: ${selfieUploadError.message}`);
        const selfieUrl = supabase.storage.from('verifications').getPublicUrl(selfieFileName).data.publicUrl;

        // Upsert Database Record with both URLs
        const { error: dbError } = await supabase.from('student_verifications').upsert({
            user_id: currentUser.id,
            legal_name: legalName,
            student_id: studentId,
            course: course,
            id_card_url: idUrl,
            selfie_url: selfieUrl,
            status: 'pending'
        }, { onConflict: 'user_id' });
        if (dbError) throw dbError;

        // Update Users Table
        const { error: userError } = await supabase.from('users').update({ verification_status: 'pending' }).eq('id', currentUser.id);
        if (userError) throw userError;

        showToast('Verification submitted successfully.', 'success');
        renderState('pending');

    } catch (error) {
        showToast(error.message || 'Failed to submit verification. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Submit for Verification';
    }
}
