import { supabase } from './supabase.js';
import { showToast } from './ui.js';

let currentUser = null;
let currentImageBlob = null;

export function initVerification(profile) {
    currentUser = profile;
    
    // 1. Force hide the entire main app UI layer
    const header = document.querySelector('header');
    const nav = document.querySelector('nav');
    const mainContent = document.getElementById('main-content');
    
    if (header) header.style.display = 'none';
    if (nav) nav.style.display = 'none';
    if (mainContent) mainContent.style.display = 'none';
    
    // 2. Display the lockdown view
    const view = document.getElementById('view-verification');
    view.classList.remove('hidden');
    view.classList.add('flex');
    
    // 3. Pre-fill data if available
    document.getElementById('verify-name').value = profile.full_name || '';
    document.getElementById('verify-student-id').value = profile.student_id || '';
    document.getElementById('verify-course').value = profile.course || '';

    // 4. Render correct state
    renderState(profile.verification_status);
    
    // 5. Setup Listeners
    document.getElementById('id-card-upload').addEventListener('change', handleImagePreview);
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
        
        if (status === 'rejected') {
            fetchRejectionReason();
        }
    } else if (status === 'pending') {
        document.getElementById('verify-state-pending').classList.remove('hidden');
        document.getElementById('verify-state-pending').classList.add('flex');
    }
}

async function fetchRejectionReason() {
    try {
        const { data, error } = await supabase
            .from('student_verifications')
            .select('rejection_reason')
            .eq('user_id', currentUser.id)
            .single();
            
        if (data && data.rejection_reason) {
            document.getElementById('verify-reject-alert').classList.remove('hidden');
            document.getElementById('verify-reject-reason').textContent = data.rejection_reason;
        }
    } catch (e) {
        console.error("Could not fetch rejection reason", e);
    }
}

function handleImagePreview(e) {
    const file = e.target.files[0];
    if (!file) return;

    const container = document.getElementById('id-card-preview-container');
    const reader = new FileReader();

    reader.onload = (event) => {
        currentImageBlob = file;
        container.innerHTML = `
            <img src="${event.target.result}" class="w-full h-full object-cover rounded-xl">
            <button type="button" class="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors z-10" onclick="event.stopPropagation(); document.getElementById('id-card-upload').value=''; currentImageBlob=null; document.getElementById('id-card-preview-container').innerHTML='<span class=\\'material-symbols-outlined text-[32px] mb-2\\'>add_photo_alternate</span><span class=\\'text-sm font-medium\\'>Tap to upload clear photo</span>';">
                <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
        `;
    };
    reader.readAsDataURL(file);
}

async function submitVerification() {
    const legalName = document.getElementById('verify-name').value.trim();
    const studentId = document.getElementById('verify-student-id').value.trim();
    const course = document.getElementById('verify-course').value.trim();
    
    if (!legalName || !studentId || !course) {
        return showToast('Please fill out all text fields.', 'warning');
    }
    if (!currentImageBlob) {
        return showToast('Please upload a photo of your College ID.', 'warning');
    }

    const btn = document.getElementById('submit-verification-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[24px]">progress_activity</span>`;

    try {
        // 1. Compress Image (Reuses global compressor from main.js)
        const compressedFile = typeof window.compressImage === 'function' ? await window.compressImage(currentImageBlob, 1080, 0.7) : currentImageBlob;
        
        // 2. Upload to Supabase Secure Storage Bucket ('verifications')
        const fileExt = compressedFile.name.split('.').pop();
        const fileName = `${currentUser.id}_${Date.now()}.${fileExt}`;
        
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('verifications')
            .upload(fileName, compressedFile);

        if (uploadError) throw new Error("Image upload failed. Ensure 'verifications' bucket exists.");

        // Get the secure URL
        const { data: urlData } = supabase.storage.from('verifications').getPublicUrl(fileName);
        const imageUrl = urlData.publicUrl;

        // 3. Upsert Verification Record
        const { error: dbError } = await supabase
            .from('student_verifications')
            .upsert({
                user_id: currentUser.id,
                legal_name: legalName,
                student_id: studentId,
                course: course,
                id_card_url: imageUrl,
                status: 'pending'
            }, { onConflict: 'user_id' });

        if (dbError) throw dbError;

        // 4. Update Users Table Status
        const { error: userError } = await supabase
            .from('users')
            .update({ verification_status: 'pending' })
            .eq('id', currentUser.id);

        if (userError) throw userError;

        // 5. Shift UI to Pending State
        showToast('Verification submitted successfully.', 'success');
        renderState('pending');

    } catch (error) {
        console.error("Verification Error:", error);
        showToast(error.message || 'Failed to submit verification. Please try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Submit for Verification';
    }
}
