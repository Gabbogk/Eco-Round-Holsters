document.addEventListener('DOMContentLoaded', () => {

    // ===== Header Scroll Effect =====
    const header = document.getElementById('header');
    window.addEventListener('scroll', () => {
        header.classList.toggle('scrolled', window.scrollY > 50);
    });

    // ===== Mobile Menu =====
    const menuBtn = document.getElementById('mobileMenuBtn');
    const nav = document.getElementById('mainNav');

    menuBtn.addEventListener('click', () => {
        menuBtn.classList.toggle('active');
        nav.classList.toggle('active');
        document.body.style.overflow = nav.classList.contains('active') ? 'hidden' : '';
    });

    document.querySelectorAll('.has-dropdown').forEach(item => {
        item.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                e.preventDefault();
                item.classList.toggle('open');
            }
        });
    });

    // ===== Hero Slider =====
    const slides = document.querySelectorAll('.hero-slide');
    const dots = document.querySelectorAll('.dot');
    let currentSlide = 0;
    let slideInterval;

    function goToSlide(index) {
        slides[currentSlide].classList.remove('active');
        dots[currentSlide].classList.remove('active');
        currentSlide = index;
        slides[currentSlide].classList.add('active');
        dots[currentSlide].classList.add('active');
    }

    function nextSlide() {
        goToSlide((currentSlide + 1) % slides.length);
    }

    function startSlider() {
        slideInterval = setInterval(nextSlide, 5000);
    }

    dots.forEach(dot => {
        dot.addEventListener('click', () => {
            clearInterval(slideInterval);
            goToSlide(parseInt(dot.dataset.slide));
            startSlider();
        });
    });

    startSlider();

    // ===== Search Modal =====
    const searchBtn = document.querySelector('.search-btn');
    const searchModal = document.getElementById('searchModal');
    const searchClose = document.getElementById('searchClose');

    searchBtn.addEventListener('click', () => {
        searchModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        searchModal.querySelector('input').focus();
    });

    searchClose.addEventListener('click', () => {
        searchModal.classList.remove('active');
        document.body.style.overflow = '';
    });

    searchModal.addEventListener('click', (e) => {
        if (e.target === searchModal) {
            searchModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchModal.classList.contains('active')) {
            searchModal.classList.remove('active');
            document.body.style.overflow = '';
        }
    });

    // ===== Gun Finder Dropdowns =====
    const gunModels = {
        'Glock': ['G17', 'G19', 'G19X', 'G26', 'G43', 'G43X', 'G45', 'G48'],
        'Sig Sauer': ['P320', 'P365', 'P365X', 'P365XL', 'P226', 'P229', 'P238', 'P938'],
        'Smith & Wesson': ['M&P Shield', 'M&P Shield Plus', 'M&P 2.0', 'SD9 VE', 'CSX'],
        'Springfield Armory': ['Hellcat', 'Hellcat Pro', 'XD-S', 'XD-M', 'Echelon', '1911'],
        'Ruger': ['LCP MAX', 'Security-9', 'SR9c', 'MAX-9', 'LC9s', '57'],
        'Beretta': ['92FS', 'PX4 Storm', 'APX', 'Nano', 'M9A3'],
        'CZ': ['P-07', 'P-10C', 'P-10S', '75 Compact', 'Shadow 2'],
        'FN': ['FN 509', 'FN 509 Tactical', 'FNX-45', 'Five-seveN'],
        'HK': ['VP9', 'VP9SK', 'P30', 'P30SK', 'USP Compact'],
        'Walther': ['PDP', 'PPQ', 'PPS M2', 'CCP M2', 'P99'],
        'Taurus': ['G2C', 'G3C', 'GX4', 'TX22', '856'],
        'Kimber': ['Micro 9', 'K6s', 'R7 Mako', '1911 Custom'],
        'Canik': ['TP9 Elite SC', 'TP9SF', 'METE MC9', 'Rival']
    };

    const brandSelect = document.getElementById('gunBrand');
    const modelSelect = document.getElementById('gunModel');

    brandSelect.addEventListener('change', () => {
        const brand = brandSelect.value;
        modelSelect.innerHTML = '<option value="">Select Model</option>';
        if (brand && gunModels[brand]) {
            gunModels[brand].forEach(model => {
                const option = document.createElement('option');
                option.textContent = model;
                option.value = model;
                modelSelect.appendChild(option);
            });
        }
    });

    // ===== Newsletter Form =====
    const newsletterForm = document.getElementById('newsletterForm');
    newsletterForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = newsletterForm.querySelector('input');
        if (input.value) {
            input.value = '';
            const btn = newsletterForm.querySelector('button');
            btn.textContent = 'SUBSCRIBED!';
            btn.style.background = '#2d7a4a';
            setTimeout(() => {
                btn.textContent = 'SUBSCRIBE';
                btn.style.background = '';
            }, 3000);
        }
    });

    // ===== Scroll Animations =====
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                observer.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.category-card, .product-card, .review-card, .trust-item, .why-list li').forEach((el, i) => {
        el.style.opacity = '0';
        el.classList.add(`animate-delay-${(i % 4) + 1}`);
        observer.observe(el);
    });

});
