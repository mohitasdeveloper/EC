import { supabase } from './supabase.js';
import { showToast } from './ui.js';

let currentUser = null;
let currentImageBlob = null;

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
    
    // Only listen for the ID Card upload now
    document.getElementById('id-card-upload').addEventListener('change', (e) => handleImagePreview(e, 'id-card-preview-container'));
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

// Cleaned up Image Previewer (Only handles ID card)
function handleImagePreview(e, containerId) {
    const file = e.target.files[0];
    if (!file) return;

    const container = document.getElementById(containerId);
    const reader = new FileReader();

    reader.onload = (event) => {
        currentImageBlob = file;

        const icon = 'add_photo_alternate';
        const text = 'Tap to upload clear photo';
        const inputId = 'id-card-upload';

        container.innerHTML = `
            <img src="${event.target.result}" class="w-full h-full object-cover rounded-xl">
            <button type="button" class="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors z-10" onclick="event.stopPropagation(); document.getElementById('${inputId}').value=''; currentImageBlob=null; document.getElementById('${containerId}').innerHTML='<span class=\\'material-symbols-outlined text-[32px] mb-2\\'>${icon}</span><span class=\\'text-sm font-medium\\'>${text}</span>';">
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

    const legalName = nameInput.value.trim();
    const studentId = idInput.value.trim();
    const course = courseInput.value.trim();
    
    [nameInput, idInput, courseInput, imageContainer].forEach(el => el.classList.remove('border-error', 'dark:border-error'));

    let hasError = false;
    if (!legalName) { nameInput.classList.add('border-error', 'dark:border-error'); hasError = true; }
    if (!studentId) { idInput.classList.add('border-error', 'dark:border-error'); hasError = true; }
    if (!course) { courseInput.classList.add('border-error', 'dark:border-error'); hasError = true; }
    
    if (hasError) return showToast('Please fill out all highlighted text fields.', 'error');

    if (!currentImageBlob) {
        imageContainer.classList.add('border-error', 'dark:border-error');
        return showToast('Please upload a photo of your College ID.', 'error');
    }

    const btn = document.getElementById('submit-verification-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[24px]">progress_activity</span>`;

    try {
        // Compress ID Image
        const compressedId = typeof window.compressImage === 'function' ? await window.compressImage(currentImageBlob, 1080, 0.7) : currentImageBlob;
        
        // Upload ID Card to Supabase
        const idFileName = `${currentUser.id}_id_${Date.now()}.${compressedId.name.split('.').pop()}`;
        const { error: idUploadError } = await supabase.storage.from('verifications').upload(idFileName, compressedId, { upsert: true });
        if (idUploadError) throw new Error(`ID Upload Failed: ${idUploadError.message}`);
        
        const idUrl = supabase.storage.from('verifications').getPublicUrl(idFileName).data.publicUrl;

        // Upsert Database Record (Selfie removed)
        const { error: dbError } = await supabase.from('student_verifications').upsert({
            user_id: currentUser.id,
            legal_name: legalName,
            student_id: studentId,
            course: course,
            id_card_url: idUrl,
            status: 'pending'
        }, { onConflict: 'user_id' });
        
        if (dbError) throw dbError;

        // Update Users Table Status
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
