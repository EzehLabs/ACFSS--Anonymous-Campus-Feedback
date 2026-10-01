const apiUrl = window.location.origin;

const menuToggle = document.querySelector('.menu-toggle');
const navItems = document.querySelector('.nav-item');
const navLinks = document.querySelectorAll('.nav-item a');

if (menuToggle && navItems) {
  menuToggle.addEventListener('click', () => {
    navItems.classList.toggle('active');
    const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!expanded));
  });

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navItems.classList.remove('active');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

const trackButton = document.getElementById('trackButton');
const trackPanel = document.getElementById('trackPanel');

if (trackButton && trackPanel) {
  trackButton.addEventListener('click', () => {
    trackPanel.classList.toggle('active');
  });
}

// ============ Complaint Form Handling ============
const feedbackForm = document.getElementById('feedbackForm');
if (feedbackForm) {
  const complaintText = document.getElementById('complaintText');
  const charCount = document.querySelector('.char-count');
  const successMessage = document.getElementById('successMessage');
  const errorMessage = document.getElementById('errorMessage');
  const submitBtn = document.getElementById('submitBtn');

  // Character counter
  if (complaintText) {
    complaintText.addEventListener('input', (e) => {
      const count = e.target.value.length;
      charCount.textContent = `${count} / 2000 chars`;
    });
  }

  // Form submission
  feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const category = document.querySelector('input[name="category"]:checked')?.value;
    const complaint = complaintText?.value?.trim();

    // Validation
    if (!category) {
      errorMessage.textContent = 'Please select a feedback category';
      errorMessage.style.display = 'block';
      successMessage.style.display = 'none';
      return;
    }

    if (!complaint || complaint.length < 20) {
      errorMessage.textContent = 'Feedback must be at least 20 characters';
      errorMessage.style.display = 'block';
      successMessage.style.display = 'none';
      return;
    }

    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    errorMessage.style.display = 'none';
    successMessage.style.display = 'none';

    try {
      const response = await fetch(`${apiUrl}/api/complaints/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          category,
          content: complaint
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit complaint');
      }

      // Success
      successMessage.style.display = 'block';
      errorMessage.style.display = 'none';
      document.getElementById('refCode').textContent = data.reference_code;

      // Reset form
      feedbackForm.reset();
      charCount.textContent = '0 / 2000 chars';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Feedback Anonymously';

      // Scroll to success message
      successMessage.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
      console.error('Submission error:', error);
      errorMessage.textContent = error.message || 'Connection error. Make sure the server is running.';
      errorMessage.style.display = 'block';
      successMessage.style.display = 'none';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Feedback Anonymously';
    }
  });
}

// ============ Track Complaint Status ============
const queryBtn = document.querySelector('.query-btn');
if (queryBtn) {
  queryBtn.addEventListener('click', async () => {
    const trackingCode = document.getElementById('trackingCode')?.value?.trim();

    if (!trackingCode) {
      alert('Please enter a tracking code');
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/api/complaints/${trackingCode}`);
      const data = await response.json();

      if (!response.ok) {
        alert('Complaint not found');
        return;
      }

      const complaint = data.complaint;
      alert(`Status: ${complaint.status}\nCategory: ${complaint.category}\nSubmitted: ${new Date(complaint.submitted_at).toLocaleString()}`);
    } catch (error) {
      console.error('Track error:', error);
      alert('Error tracking complaint. Make sure the server is running.');
    }
  });
}


function getFaq(){
  window.alert("Frequently asked questions is still under construction by the IT team")
  console.log("User clicked the FAQ button")
}

const heroImage = document.getElementById('heroImage');

if (heroImage) {
  const heroImages = [
    {
      src: 'images/Gemini_Generated_Image_qcdfz8qcdfz8qcdf-removebg-preview.png',
      alt: 'Student sharing an anonymous campus concern'
    },
    {
      src: 'images/Gemini_Generated_Image_o6pmelo6pmelo6pm__1_-removebg-preview.png',
      alt: 'Student sharing an anonymous campus concern'
    }
  ];
  let activeHeroImage = 0;

  window.setInterval(() => {
    activeHeroImage = (activeHeroImage + 1) % heroImages.length;
    heroImage.src = heroImages[activeHeroImage].src;
    heroImage.alt = heroImages[activeHeroImage].alt;
  }, 10000);
}
