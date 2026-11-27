// src/pages/Home.jsx

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import '../styles/main.css';
import '../styles/home-responsive.css';
import '../styles/snake-slider.css';

const FEATURES = [
  {
    icon: 'shield-alt',
    title: 'حماية متقدمة',
    text: 'قوائم بيضاء وسوداء وإدارة كاملة لأجهزة USB',
    img: '/feature-advanced-security.png'
  },
  {
    icon: 'link',
    title: 'بلوكتشين آمن',
    text: 'تسجيل غير قابل للتعديل لكافة العمليات',
    img: '/feature-blockchain.png'
  },
  {
    icon: 'brain',
    title: 'ذكاء اصطناعي',
    text: 'اكتشاف سلوك مشبوه وتحليلات ذكية',
    img: '/feature-ai.png'
  }
];

const BENEFITS = [
  {
    icon: 'lock',
    title: 'تأمين عالي المستوى',
    text: 'حماية بياناتك من أجهزة USB غير المصرح بها',
    img: '/benefit-security.png'
  },
  {
    icon: 'chart-line',
    title: 'مراقبة فورية',
    text: 'تنبيهات في الوقت الحقيقي عند اكتشاف المخاطر',
    img: '/benefit-realtime.png'
  },
  {
    icon: 'cogs',
    title: 'سهولة الإدارة',
    text: 'واجهة بديهية لإدارة الأجهزة والسياسات',
    img: '/benefit-management.png'
  },
  {
    icon: 'clipboard-list',
    title: 'تقارير شاملة',
    text: 'تصدير البيانات بعدة صيغ ومتابعة لحظية',
    img: '/benefit-reports.png'
  }
];

const Home = () => {
  // تحكم في ظهور كل قسم بالكامل
  const [showAllFeatures, setShowAllFeatures] = useState(false);
  const [showAllBenefits, setShowAllBenefits] = useState(false);
  const [currentFeatureIndex, setCurrentFeatureIndex] = useState(0);
  const [currentBenefitIndex, setCurrentBenefitIndex] = useState(0);

  // تفعيل التأثيرات عند تحميل الصفحة
  useEffect(() => {
    // إضافة كلاس خاص للحركات المتقدمة
    document.body.classList.add('advanced-animations');
    
    // تنظيف الكلاس عند مغادرة الصفحة
    return () => {
      document.body.classList.remove('advanced-animations');
    };
  }, []);

  // حركة الصور كلعبة الحية - الميزات
  useEffect(() => {
    if (!showAllFeatures) return;
    
    const interval = setInterval(() => {
      setCurrentFeatureIndex(prev => (prev + 1) % FEATURES.length);
    }, 3000); // كل 3 ثوان

    return () => clearInterval(interval);
  }, [showAllFeatures]);

  // حركة الصور كلعبة الحية - البنافت
  useEffect(() => {
    if (!showAllBenefits) return;
    
    const interval = setInterval(() => {
      setCurrentBenefitIndex(prev => (prev + 1) % BENEFITS.length);
    }, 3500); // كل 3.5 ثوان

    return () => clearInterval(interval);
  }, [showAllBenefits]);

  return (
    <>
      <Header />
      <main>
        {/* Hero Section */}
        <section
          className="hero-section d-flex align-items-center justify-content-center text-center text-white position-relative overflow-hidden"
          style={{
            minHeight: 'calc(100vh - 56px)',
            background: 'var(--primary-color)',
            backgroundImage: 'linear-gradient(135deg, var(--primary-color) 0%, #1e40af 100%)',
            paddingTop: '2rem',
            paddingBottom: '2rem'
          }}
        >
          {/* إضافة تأثيرات خلفية متحركة */}
          <div 
            className="position-absolute w-100 h-100"
            style={{
              background: `
                radial-gradient(circle at 20% 80%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
                radial-gradient(circle at 40% 40%, rgba(255, 255, 255, 0.05) 0%, transparent 50%)
              `,
              animation: 'float3D 8s ease-in-out infinite'
            }}
          />
          <div className="container position-relative" style={{ zIndex: 2 }}>
            <h1 
              className="fw-bold mb-3"
              style={{
                textShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                animation: 'slideRightToLeft 1s ease-out forwards',
                fontSize: 'clamp(1.5rem, 4vw, 2.8rem)',
                lineHeight: '1.2'
              }}
            >
              Smart Zero-Trust Peripheral Security
            </h1>
            <p 
              className="mb-4"
              style={{
                textShadow: '0 2px 10px rgba(0, 0, 0, 0.2)',
                animation: 'slideRightToLeft 1.2s ease-out forwards',
                animationDelay: '0.3s',
                opacity: 0,
                animationFillMode: 'forwards',
                fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
                maxWidth: '800px',
                margin: '0 auto'
              }}
            >
              🔒 حماية متقدمة للأجهزة الطرفية باستخدام الذكاء الاصطناعي و Blockchain Forensics
            </p>
            <div
              style={{
                animation: 'slideRightToLeft 1.4s ease-out forwards',
                animationDelay: '0.6s',
                opacity: 0,
                animationFillMode: 'forwards',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '1rem',
                justifyContent: 'center',
                alignItems: 'center'
              }}
            >
              <Link 
                to="/register" 
                className="btn btn-light btn-lg"
                style={{
                  boxShadow: '0 4px 20px rgba(255, 255, 255, 0.3)',
                  transition: 'all 0.3s ease',
                  transform: 'perspective(1000px) rotateX(0deg)',
                  fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
                  padding: '0.75rem 2rem',
                  minWidth: '140px',
                  fontWeight: '600'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'perspective(1000px) rotateX(-5deg) translateY(-5px)';
                  e.target.style.boxShadow = '0 8px 30px rgba(255, 255, 255, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'perspective(1000px) rotateX(0deg) translateY(0px)';
                  e.target.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.3)';
                }}
              >
                🚀 ابدأ الآن مجاناً
              </Link>
              <Link 
                to="/login" 
                className="btn btn-outline-light btn-lg"
                style={{
                  boxShadow: '0 4px 20px rgba(255, 255, 255, 0.2)',
                  transition: 'all 0.3s ease',
                  transform: 'perspective(1000px) rotateX(0deg)',
                  fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
                  padding: '0.75rem 2rem',
                  minWidth: '140px',
                  fontWeight: '500'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'perspective(1000px) rotateX(-5deg) translateY(-5px)';
                  e.target.style.boxShadow = '0 8px 30px rgba(255, 255, 255, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'perspective(1000px) rotateX(0deg) translateY(0px)';
                  e.target.style.boxShadow = '0 4px 20px rgba(255, 255, 255, 0.2)';
                }}
              >
                تسجيل الدخول
              </Link>
            </div>
          </div>
        </section>

        {/* مميزات النظام */}
        <section className="features-section py-5" aria-label="مميزات النظام" style={{ overflow: 'hidden' }}>
          <div className="container">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
              <h2 className="text-center mb-0">مميزات النظام</h2>
              <button
                className={`btn ${showAllFeatures ? 'btn-danger' : 'btn-primary'} fw-bold`}
                onClick={() => setShowAllFeatures(v => !v)}
                style={{ 
                  minWidth: 160,
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
                  transition: 'all 0.3s ease',
                  transform: 'scale(1)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'scale(1.05)';
                  e.target.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'scale(1)';
                  e.target.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.1)';
                }}
              >
                <i className={`fas ${showAllFeatures ? 'fa-eye-slash' : 'fa-eye'} me-2`}></i>
                {showAllFeatures ? "🔒 إغلاق المميزات" : "🎯 عرض كل المميزات"}
              </button>
            </div>

            {showAllFeatures && (
              <div className="snake-slider-container" style={{ 
                position: 'relative', 
                height: '450px',
                overflow: 'hidden',
                background: 'linear-gradient(135deg, #f8fafc 0%, var(--mid) 100%)',
                borderRadius: '20px',
                padding: '20px'
              }}>
                {/* الصور المتحركة كلعبة الحية */}
                <div className="snake-images-track" style={{
                  position: 'absolute',
                  top: '50%',
                  left: '0',
                  width: '400%',
                  height: '300px',
                  transform: `translateY(-50%) translateX(${-currentFeatureIndex * 25}%)`,
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'transform 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  zIndex: 1
                }}>
                  {[...FEATURES, ...FEATURES, ...FEATURES, ...FEATURES].map((f, idx) => (
                    <div
                      key={`feature-${idx}`}
                      className="snake-image-item"
                      style={{
                        flex: '0 0 25%',
                        height: '250px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 20px'
                      }}
                    >
                      <img
                        src={f.img}
                        alt={f.title}
                        style={{
                          maxWidth: '200px',
                          maxHeight: '200px',
                          objectFit: 'contain',
                          borderRadius: '20px',
                          background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
                          border: '4px solid rgba(30, 64, 175, 0.6)',
                          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3), 0 0 30px rgba(30, 64, 175, 0.4)',
                          transform: idx % FEATURES.length === currentFeatureIndex 
                            ? 'scale(1.2) rotateY(5deg)' 
                            : 'scale(0.8) rotateY(-10deg)',
                          transition: 'all 0.8s ease-out',
                          opacity: idx % FEATURES.length === currentFeatureIndex ? 1 : 0.6,
                          filter: idx % FEATURES.length === currentFeatureIndex 
                            ? 'brightness(1.2) contrast(1.1)' 
                            : 'brightness(0.8)',
                          zIndex: idx % FEATURES.length === currentFeatureIndex ? 10 : 1
                        }}
                      />
                    </div>
                  ))}
                </div>

                {/* معلومات الميزة الحالية */}
                <div className="current-feature-info" style={{
                  position: 'absolute',
                  bottom: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(10px)',
                  padding: '20px 30px',
                  borderRadius: '15px',
                  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
                  textAlign: 'center',
                  zIndex: 5,
                  border: '2px solid rgba(30, 64, 175, 0.2)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px' }}>
                    <i
                      className={`fas fa-${FEATURES[currentFeatureIndex].icon} fa-2x text-primary`}
                      style={{
                        textShadow: '0 2px 10px rgba(30, 64, 175, 0.3)',
                        filter: 'drop-shadow(0 0 10px rgba(30, 64, 175, 0.5))'
                      }}
                    />
                    <div>
                      <h4 className="mb-1 fw-bold text-primary">{FEATURES[currentFeatureIndex].title}</h4>
                      <p className="mb-0" style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                        {FEATURES[currentFeatureIndex].text}
                      </p>
                    </div>
                  </div>
                </div>

                {/* مؤشرات التقدم */}
                <div className="progress-indicators" style={{
                  position: 'absolute',
                  top: '20px',
                  right: '20px',
                  display: 'flex',
                  gap: '8px',
                  zIndex: 5
                }}>
                  {FEATURES.map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: idx === currentFeatureIndex 
                          ? 'linear-gradient(45deg, #1e40af, #3b82f6)' 
                          : 'rgba(255, 255, 255, 0.5)',
                        border: '2px solid rgba(30, 64, 175, 0.3)',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer',
                        boxShadow: idx === currentFeatureIndex 
                          ? '0 0 15px rgba(30, 64, 175, 0.6)' 
                          : 'none'
                      }}
                      onClick={() => setCurrentFeatureIndex(idx)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* لماذا تختار نظامنا */}
        <section className="benefits-section py-5" style={{ background: '#f4f6fa', overflow: 'hidden' }}>
          <div className="container">
            <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
              <h2 className="text-center mb-0">لماذا تختار نظامنا؟</h2>
              <button
                className={`btn ${showAllBenefits ? 'btn-danger' : 'btn-success'} fw-bold`}
                onClick={() => setShowAllBenefits(v => !v)}
                style={{ 
                  minWidth: 180,
                  boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
                  transition: 'all 0.3s ease',
                  transform: 'scale(1)'
                }}
                onMouseEnter={(e) => {
                  e.target.style.transform = 'scale(1.05)';
                  e.target.style.boxShadow = '0 6px 20px rgba(0, 0, 0, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.transform = 'scale(1)';
                  e.target.style.boxShadow = '0 4px 15px rgba(0, 0, 0, 0.1)';
                }}
              >
                <i className={`fas ${showAllBenefits ? 'fa-times-circle' : 'fa-star'} me-2`}></i>
                {showAllBenefits ? "❌ إغلاق الأسباب" : "⭐ عرض جميع الأسباب"}
              </button>
            </div>
            
            {showAllBenefits && (
              <div className="snake-slider-container" style={{ 
                position: 'relative', 
                height: '400px',
                overflow: 'hidden',
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                borderRadius: '20px',
                padding: '20px'
              }}>
                {/* الصور المتحركة كلعبة الحية - البنافت */}
                <div className="snake-images-track" style={{
                  position: 'absolute',
                  top: '50%',
                  left: '0',
                  width: '400%',
                  height: '250px',
                  transform: `translateY(-50%) translateX(${-currentBenefitIndex * 25}%)`,
                  display: 'flex',
                  alignItems: 'center',
                  transition: 'transform 1.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
                  zIndex: 1
                }}>
                  {[...BENEFITS, ...BENEFITS, ...BENEFITS, ...BENEFITS].map((b, idx) => (
                    <div
                      key={`benefit-${idx}`}
                      className="snake-image-item"
                      style={{
                        flex: '0 0 25%',
                        height: '200px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0 15px'
                      }}
                    >
                      <img
                        src={b.img}
                        alt={b.title}
                        style={{
                          maxWidth: '160px',
                          maxHeight: '160px',
                          objectFit: 'contain',
                          borderRadius: '15px',
                          background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
                          border: '3px solid rgba(16, 185, 129, 0.6)',
                          boxShadow: '0 15px 30px rgba(0, 0, 0, 0.2), 0 0 25px rgba(16, 185, 129, 0.4)',
                          transform: idx % BENEFITS.length === currentBenefitIndex 
                            ? 'scale(1.15) rotateY(-5deg)' 
                            : 'scale(0.85) rotateY(10deg)',
                          transition: 'all 0.8s ease-out',
                          opacity: idx % BENEFITS.length === currentBenefitIndex ? 1 : 0.7,
                          filter: idx % BENEFITS.length === currentBenefitIndex 
                            ? 'brightness(1.1) contrast(1.05)' 
                            : 'brightness(0.9)',
                          zIndex: idx % BENEFITS.length === currentBenefitIndex ? 10 : 1
                        }}
                      />
                    </div>
                  ))}
                </div>

                {/* معلومات البنفت الحالي */}
                <div className="current-benefit-info" style={{
                  position: 'absolute',
                  bottom: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  background: 'rgba(255, 255, 255, 0.95)',
                  backdropFilter: 'blur(10px)',
                  padding: '15px 25px',
                  borderRadius: '12px',
                  boxShadow: '0 8px 25px rgba(0, 0, 0, 0.1)',
                  textAlign: 'center',
                  zIndex: 5,
                  border: '2px solid rgba(16, 185, 129, 0.2)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                    <i
                      className={`fas fa-${BENEFITS[currentBenefitIndex].icon} fa-2x`}
                      style={{
                        color: 'var(--success-color)',
                        textShadow: '0 2px 10px rgba(16, 185, 129, 0.3)',
                        filter: 'drop-shadow(0 0 8px rgba(16, 185, 129, 0.5))'
                      }}
                    />
                    <div>
                      <h5 className="mb-1 fw-bold" style={{ color: 'var(--success-color)' }}>
                        {BENEFITS[currentBenefitIndex].title}
                      </h5>
                      <p className="mb-0" style={{ color: 'var(--primary-color)', fontSize: '13px', fontWeight: 500 }}>
                        {BENEFITS[currentBenefitIndex].text}
                      </p>
                    </div>
                  </div>
                </div>

                {/* مؤشرات التقدم - البنافت */}
                <div className="progress-indicators" style={{
                  position: 'absolute',
                  top: '20px',
                  right: '20px',
                  display: 'flex',
                  gap: '6px',
                  zIndex: 5
                }}>
                  {BENEFITS.map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: idx === currentBenefitIndex 
                          ? 'linear-gradient(45deg, var(--success-color), #34d399)' 
                          : 'rgba(255, 255, 255, 0.6)',
                        border: '2px solid rgba(16, 185, 129, 0.3)',
                        transition: 'all 0.3s ease',
                        cursor: 'pointer',
                        boxShadow: idx === currentBenefitIndex 
                          ? '0 0 12px rgba(16, 185, 129, 0.6)' 
                          : 'none'
                      }}
                      onClick={() => setCurrentBenefitIndex(idx)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Call to action */}
        <section
          className="cta-section text-center text-white py-5"
          style={{
            background: 'var(--primary-color)',
            backgroundImage: 'linear-gradient(135deg, var(--primary-color) 0%, #1e40af 100%)'
          }}
        >
          <div className="container">
            <h2 className="mb-3">ابدأ في حماية نظامك اليوم</h2>
            <p className="mb-4">
              انضم إلى المؤسسات التي تثق بنا في تأمين منافذ USB
            </p>
            <Link to="/register" className="btn btn-light btn-lg me-2">
              تسجيل مجاني
            </Link>
            <Link to="/login" className="btn btn-outline-light btn-lg">
              تسجيل الدخول
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};

export default Home;
