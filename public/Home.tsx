import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Camera, CheckCircle, Loader2, Phone, RefreshCw, Lock, Zap, Copy } from 'lucide-react';

interface ScannerState {
  status: 'booting' | 'ready' | 'scanning' | 'success' | 'error' | 'no-camera' | 'permission-denied' | 'requesting-permission' | 'camera-busy' | 'not-supported' | 'ocr-loading' | 'ocr-error';
  detectedCode: string | null;
  ussdCode: string | null;
  lastScannedCode: string | null;
  errorMessage: string | null;
  frameColor: 'green' | 'yellow' | 'success' | 'error';
  scanCount: number;
  diagnostics: string[];
  ocrReady: boolean;
  ocrProgress: number;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const ocrWorkerRef = useRef<any>(null);
  const isProcessingRef = useRef(false);
  const lastScannedTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraStartedRef = useRef(false);
  const ocrInitializedRef = useRef(false);

  const [state, setState] = useState<ScannerState>({
    status: 'requesting-permission',
    detectedCode: null,
    ussdCode: null,
    lastScannedCode: null,
    errorMessage: null,
    frameColor: 'green',
    scanCount: 0,
    diagnostics: [],
    ocrReady: false,
    ocrProgress: 0,
  });

  const addDiagnostic = (message: string) => {
    console.log('[DIAGNOSTIC]', message);
    setState(prev => ({
      ...prev,
      diagnostics: [...prev.diagnostics.slice(-14), message],
    }));
  };

  useEffect(() => {
    const startCameraImmediately = async () => {
      if (cameraStartedRef.current) return;
      cameraStartedRef.current = true;

      addDiagnostic('🎥 جاري طلب إذن الكاميرا...');

      try {
        const constraints: MediaStreamConstraints = {
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        };

        addDiagnostic('📷 جاري بدء الكاميرا...');
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        
        addDiagnostic('✅ تم الحصول على تدفق الكاميرا');

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          videoRef.current.onloadedmetadata = () => {
            addDiagnostic(`📹 دقة الكاميرا: ${videoRef.current?.videoWidth}x${videoRef.current?.videoHeight}`);
          };

          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                addDiagnostic('▶️ تم تشغيل الفيديو بنجاح');
              })
              .catch(e => {
                addDiagnostic(`❌ خطأ في تشغيل الفيديو: ${e.message}`);
              });
          }

          try {
            const track = stream.getVideoTracks()[0];
            if (track) {
              addDiagnostic('⚙️ جاري تطبيق الإعدادات المتقدمة...');
              const capabilities = track.getCapabilities() as any;
              
              if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
                await track.applyConstraints({
                  advanced: [{ focusMode: 'continuous' } as any],
                } as any);
                addDiagnostic('✅ تم تفعيل التركيز المستمر');
              }
              
              if (capabilities.zoom) {
                await track.applyConstraints({
                  advanced: [{ zoom: 2 } as any],
                } as any);
                addDiagnostic('✅ تم تطبيق التكبير');
              }
            }
          } catch (e) {
            addDiagnostic('⚠️ الإعدادات المتقدمة غير مدعومة');
          }

          setState(prev => ({ ...prev, status: 'ocr-loading' }));
          addDiagnostic('🎯 الكاميرا جاهزة، جاري تحميل OCR...');
        }
      } catch (error: any) {
        addDiagnostic(`❌ خطأ: ${error.name} - ${error.message}`);
        
        let errorMsg = 'لا يمكن الوصول للكاميرا';
        let newStatus: ScannerState['status'] = 'no-camera';

        if (error.name === 'NotAllowedError') {
          errorMsg = 'تم رفض إذن الكاميرا. يرجى السماح بالوصول للكاميرا';
          newStatus = 'permission-denied';
          addDiagnostic('🚫 تم رفض إذن الكاميرا من قبل المستخدم');
        } else if (error.name === 'NotFoundError') {
          errorMsg = 'لم يتم العثور على كاميرا على الجهاز';
          newStatus = 'no-camera';
          addDiagnostic('🔍 لم يتم العثور على كاميرا');
        } else if (error.name === 'NotReadableError') {
          errorMsg = 'الكاميرا قيد الاستخدام من قبل تطبيق آخر أو معطلة';
          newStatus = 'camera-busy';
          addDiagnostic('⚠️ الكاميرا مشغولة أو معطلة');
        } else if (error.name === 'SecurityError') {
          errorMsg = 'لا يمكن الوصول للكاميرا. تأكد من استخدام HTTPS';
          newStatus = 'error';
          addDiagnostic('🔒 خطأ أمان: قد تحتاج لـ HTTPS');
        }
        
        setState(prev => ({
          ...prev,
          status: newStatus,
          errorMessage: errorMsg,
        }));
      }
    };

    startCameraImmediately();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
          addDiagnostic('⏹️ تم إيقاف تدفق الكاميرا');
        });
      }
    };
  }, []);

  useEffect(() => {
    if (ocrInitializedRef.current) return;
    ocrInitializedRef.current = true;

    const initializeTesseract = async () => {
      addDiagnostic('📚 جاري تحميل مكتبة Tesseract.js v4...');
      
      try {
        const scriptUrl = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.1/dist/tesseract.min.js';
        addDiagnostic(`🔗 جاري التحميل من: cdn.jsdelivr.net`);

        // @ts-ignore
        if ((window as any).Tesseract) {
          addDiagnostic('✅ مكتبة Tesseract موجودة بالفعل');
        } else {
          const script = document.createElement('script');
          script.src = scriptUrl;
          script.async = true;
          
          const scriptPromise = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Script loading timeout'));
            }, 60000);

            script.onload = () => {
              clearTimeout(timeout);
              addDiagnostic('✅ تم تحميل مكتبة Tesseract بنجاح');
              resolve();
            };
            
            script.onerror = () => {
              clearTimeout(timeout);
              reject(new Error('Script loading failed'));
            };
          });

          document.head.appendChild(script);
          await scriptPromise;
        }

        addDiagnostic('🔧 جاري إنشاء Web Worker...');
        
        // @ts-ignore
        const Tesseract = (window as any).Tesseract;
        
        if (!Tesseract || !Tesseract.createWorker) {
          throw new Error('Tesseract.createWorker not found');
        }

        ocrWorkerRef.current = Tesseract.createWorker({
          logger: (m: any) => {
            if (m.status === 'recognizing') {
              const progress = Math.round(m.progress * 100);
              setState(prev => ({ ...prev, ocrProgress: progress }));
              if (progress > 0 && progress < 100) {
                addDiagnostic(`⏳ معالجة: ${progress}%`);
              }
            }
          }
        });

        addDiagnostic('⏳ جاري تهيئة Worker...');
        
        // Tesseract.js v4 يتم تهيئته تلقائياً عند أول استدعاء recognize
        // لا نحتاج لـ loadLanguage أو initialize بشكل منفصل
        addDiagnostic('✅ تم إعداد محرك OCR');

        addDiagnostic('✅ تم إعداد محرك OCR بنجاح');
        addDiagnostic('🎉 محرك OCR جاهز للعمل الآن');
        setState(prev => ({ 
          ...prev, 
          status: 'ready', 
          ocrReady: true, 
          errorMessage: null,
          ocrProgress: 100,
        }));
      } catch (error: any) {
        addDiagnostic(`❌ خطأ في إعداد OCR: ${error.message}`);
        console.error('خطأ في إعداد Tesseract:', error);
        
        setState(prev => ({
          ...prev,
          status: 'ocr-error',
          ocrReady: false,
          errorMessage: `فشل إعداد محرك OCR: ${error.message}`,
        }));
      }
    };

    initializeTesseract();

    return () => {
      if (ocrWorkerRef.current) {
        ocrWorkerRef.current.terminate().catch(() => {});
      }
    };
  }, []);

  const extractCardNumber = (text: string): string | null => {
    if (!text || text.trim().length === 0) return null;

    let cleaned = text.replace(/\s+/g, '').toUpperCase();

    cleaned = cleaned
      .replace(/O/g, '0').replace(/o/g, '0')
      .replace(/l/g, '1').replace(/L/g, '1').replace(/I/g, '1').replace(/i/g, '1')
      .replace(/S/g, '5').replace(/s/g, '5')
      .replace(/Z/g, '2').replace(/z/g, '2')
      .replace(/B/g, '8').replace(/b/g, '8')
      .replace(/G/g, '6').replace(/g/g, '6')
      .replace(/T/g, '7').replace(/t/g, '7')
      .replace(/Q/g, '0').replace(/q/g, '0')
      .replace(/V/g, '4').replace(/v/g, '4')
      .replace(/Y/g, '4').replace(/y/g, '4');

    cleaned = cleaned.replace(/[^0-9*#]/g, '');

    let match = cleaned.match(/858(\d{12,16})#?/);
    if (match) {
      const cardNum = match[1];
      if (cardNum.length >= 12 && cardNum.length <= 16) {
        return cardNum;
      }
    }

    match = cleaned.match(/#?(\d{12,16})858/);
    if (match) {
      const cardNum = match[1];
      if (cardNum.length >= 12 && cardNum.length <= 16) {
        return cardNum;
      }
    }

    const allNumbers = cleaned.match(/(\d{12,16})/g);
    if (allNumbers) {
      for (const cardNum of allNumbers) {
        if (cardNum.length >= 12 && cardNum.length <= 16) {
          return cardNum;
        }
      }
    }

    return null;
  };

  const enhanceImage = (imageData: ImageData) => {
    const data = imageData.data;
    const len = data.length;
    
    let sum = 0;
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = (r + g + b) / 3;
      sum += gray;
    }
    
    const threshold = sum / (len / 4);
    
    for (let i = 0; i < len; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = (r + g + b) / 3;
      
      const bw = gray > threshold ? 255 : 0;
      
      data[i] = bw;
      data[i + 1] = bw;
      data[i + 2] = bw;
    }
  };

  const scanFrame = async () => {
    if (!videoRef.current || !ocrWorkerRef.current || isProcessingRef.current || !state.ocrReady) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    frameCountRef.current++;
    if (frameCountRef.current % 5 !== 0) {
      animationFrameRef.current = requestAnimationFrame(scanFrame);
      return;
    }

    try {
      isProcessingRef.current = true;

      if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d')!;

      if (!ctx) {
        animationFrameRef.current = requestAnimationFrame(scanFrame);
        return;
      }

      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;

      ctx.drawImage(videoRef.current, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      enhanceImage(imageData);
      ctx.putImageData(imageData, 0, 0);

      setState(prev => ({ ...prev, status: 'scanning', frameColor: 'yellow' }));
      
      let text = '';
      try {
        // استخدام Tesseract.js مباشرة بدون worker
        // @ts-ignore
        const Tesseract = (window as any).Tesseract;
        
        if (!Tesseract || !Tesseract.recognize) {
          throw new Error('لم يتم تحميل Tesseract.js');
        }
        
        const result = await Tesseract.recognize(canvas, 'eng', {
          logger: (m: any) => {
            if (m.status === 'recognizing') {
              const progress = Math.round(m.progress * 100);
              if (progress > 0 && progress < 100) {
                addDiagnostic(`⏳ معالجة: ${progress}%`);
              }
            }
          }
        });
        
        text = (result.data.text || '').trim();
        
        if (text.length > 0) {
          addDiagnostic(`📝 نص مقروء: ${text.substring(0, 50)}...`);
        } else {
          addDiagnostic('⚠️ لم يتم اكتشاف نص في الصورة');
        }
      } catch (ocrError: any) {
        addDiagnostic(`❌ خطأ في OCR: ${ocrError.message}`);
        text = '';
      }

      if (text.trim().length > 0) {
        setState(prev => ({ ...prev, frameColor: 'yellow' }));
        setTimeout(() => {
          setState(prev => prev.frameColor === 'yellow' ? { ...prev, frameColor: 'green' } : prev);
        }, 150);
      }

      const cardNumber = extractCardNumber(text);

      if (cardNumber) {
        const now = Date.now();
        if (now - lastScannedTimeRef.current > 2000) {
          const ussdCode = `858${cardNumber}#`;
          
          setState(prev => ({
            ...prev,
            detectedCode: cardNumber,
            ussdCode: ussdCode,
            lastScannedCode: ussdCode,
            status: 'success',
            frameColor: 'success',
            errorMessage: null,
            scanCount: prev.scanCount + 1,
          }));
          
          addDiagnostic(`✅ تم قراءة كارت: ${cardNumber}`);
          lastScannedTimeRef.current = now;

          if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
          }

          setTimeout(() => {
            setState(prev => ({
              ...prev,
              status: 'ready',
              frameColor: 'green',
              detectedCode: null,
              ussdCode: null,
            }));
          }, 3000);
        }
      } else {
        setState(prev => prev.status === 'scanning' ? { ...prev, status: 'ready' } : prev);
      }
    } catch (error) {
      console.error('خطأ في المسح:', error);
      setState(prev => prev.status === 'scanning' ? { ...prev, status: 'ready' } : prev);
    } finally {
      isProcessingRef.current = false;
      animationFrameRef.current = requestAnimationFrame(scanFrame);
    }
  };

  useEffect(() => {
    if (state.status === 'ready' && state.ocrReady) {
      const checkVideoReady = () => {
        if (videoRef.current?.readyState === videoRef.current?.HAVE_ENOUGH_DATA) {
          animationFrameRef.current = requestAnimationFrame(scanFrame);
        } else {
          setTimeout(checkVideoReady, 100);
        }
      };
      checkVideoReady();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [state.status, state.ocrReady]);

  const handleCall = () => {
    if (state.ussdCode) {
      window.location.href = `tel:${state.ussdCode}`;
    }
  };

  const handleCopy = async () => {
    if (state.ussdCode) {
      try {
        await navigator.clipboard.writeText(state.ussdCode);
        addDiagnostic('✅ تم نسخ الكود إلى الحافظة');
      } catch (err) {
        addDiagnostic('❌ فشل نسخ الكود');
      }
    }
  };

  const handleRetry = () => {
    addDiagnostic('🔄 جاري إعادة المحاولة...');
    cameraStartedRef.current = false;
    setState(prev => ({
      ...prev,
      status: 'requesting-permission',
      errorMessage: null,
      diagnostics: [],
    }));
    window.location.reload();
  };

  const handleReload = () => {
    addDiagnostic('🔄 جاري إعادة تحميل الصفحة...');
    window.location.reload();
  };

  const getFrameColor = () => {
    switch (state.frameColor) {
      case 'yellow':
        return 'border-yellow-400 shadow-lg shadow-yellow-400/50';
      case 'success':
        return 'border-green-500 shadow-lg shadow-green-500/50';
      case 'error':
        return 'border-red-500 shadow-lg shadow-red-500/50';
      default:
        return 'border-green-400 shadow-lg shadow-green-400/50';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center p-4">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Camera className="w-8 h-8 text-green-400 mr-2 animate-pulse" />
            <h1 className="text-3xl font-bold text-white" style={{ fontFamily: 'Poppins, sans-serif' }}>ماسح فودافون</h1>
          </div>
          <p className="text-slate-400 text-sm">قراءة كروت الشحن بتقنية OCR</p>
        </div>

        <div className={`relative mb-6 rounded-lg overflow-hidden border-4 transition-all duration-300 ${getFrameColor()}`}>
          <div className="aspect-video bg-slate-950 flex items-center justify-center">
            {state.status !== 'no-camera' && state.status !== 'permission-denied' && state.status !== 'not-supported' && state.status !== 'camera-busy' && (
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
              />
            )}
            
            {state.status === 'requesting-permission' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center">
                  <Lock className="w-12 h-12 text-blue-400 mx-auto mb-3 animate-pulse" />
                  <p className="text-white text-sm mb-2 font-semibold">جاري طلب إذن الكاميرا</p>
                  <p className="text-slate-400 text-xs mb-4">يرجى السماح بالوصول للكاميرا</p>
                  <Loader2 className="w-6 h-6 text-blue-400 animate-spin mx-auto" />
                </div>
              </div>
            )}

            {state.status === 'ocr-loading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center">
                  <Loader2 className="w-8 h-8 text-green-400 animate-spin mx-auto mb-2" />
                  <p className="text-white text-sm font-semibold">جاري تحميل محرك المسح</p>
                  <p className="text-slate-400 text-xs mt-2">قد يستغرق بعض الوقت</p>
                  {state.ocrProgress > 0 && (
                    <div className="mt-4 w-32 h-1 bg-slate-700 rounded-full mx-auto overflow-hidden">
                      <div 
                        className="h-full bg-green-400 transition-all duration-300"
                        style={{ width: `${state.ocrProgress}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {state.status === 'ocr-error' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center px-4">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                  <p className="text-white text-sm mb-2 font-semibold">خطأ في تحميل OCR</p>
                  <p className="text-slate-400 text-xs mb-4">{state.errorMessage}</p>
                  <button
                    onClick={handleReload}
                    className="flex items-center justify-center mx-auto px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    إعادة تحميل
                  </button>
                </div>
              </div>
            )}

            {state.status === 'permission-denied' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center px-4">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                  <p className="text-white text-sm mb-2 font-semibold">تم رفض إذن الكاميرا</p>
                  <p className="text-slate-400 text-xs mb-4">
                    يرجى السماح بالوصول للكاميرا في إعدادات المتصفح
                  </p>
                  <button
                    onClick={handleRetry}
                    className="flex items-center justify-center mx-auto px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    حاول مجددًا
                  </button>
                </div>
              </div>
            )}

            {state.status === 'camera-busy' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center px-4">
                  <Zap className="w-12 h-12 text-yellow-400 mx-auto mb-3" />
                  <p className="text-white text-sm mb-2 font-semibold">الكاميرا مشغولة</p>
                  <p className="text-slate-400 text-xs mb-4">
                    الكاميرا قيد الاستخدام. أغلق التطبيقات الأخرى وحاول مجددًا
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRetry}
                      className="flex-1 flex items-center justify-center px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm transition-colors"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      حاول مجددًا
                    </button>
                    <button
                      onClick={handleReload}
                      className="flex-1 flex items-center justify-center px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm transition-colors"
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      إعادة تحميل
                    </button>
                  </div>
                </div>
              </div>
            )}

            {state.status === 'no-camera' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                  <p className="text-white text-sm mb-4">{state.errorMessage}</p>
                  <button
                    onClick={handleReload}
                    className="flex items-center justify-center mx-auto px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm transition-colors"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    إعادة تحميل
                  </button>
                </div>
              </div>
            )}

            {state.status === 'not-supported' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur">
                <div className="text-center px-4">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                  <p className="text-white text-sm mb-2 font-semibold">المتصفح غير مدعوم</p>
                  <p className="text-slate-400 text-xs">{state.errorMessage}</p>
                </div>
              </div>
            )}
          </div>

          {state.status === 'ready' && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/3 left-1/4 w-1/2 h-1/3 border-2 border-green-400/30 rounded-lg"></div>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-16 h-16 border-4 border-green-400/20 rounded-full animate-pulse"></div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-sm">الحالة</span>
            <div className="flex items-center">
              {state.status === 'ready' && (
                <>
                  <div className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></div>
                  <span className="text-green-400 text-sm font-medium">جاهز</span>
                </>
              )}
              {state.status === 'scanning' && (
                <>
                  <Loader2 className="w-4 h-4 text-yellow-400 animate-spin mr-2" />
                  <span className="text-yellow-400 text-sm font-medium">جاري المسح</span>
                </>
              )}
              {state.status === 'success' && (
                <>
                  <CheckCircle className="w-4 h-4 text-green-400 mr-2" />
                  <span className="text-green-400 text-sm font-medium">نجح ✓</span>
                </>
              )}
              {state.status === 'ocr-loading' && (
                <>
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin mr-2" />
                  <span className="text-blue-400 text-sm font-medium">تحميل OCR</span>
                </>
              )}
              {state.status === 'ocr-error' && (
                <>
                  <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
                  <span className="text-red-400 text-sm font-medium">خطأ OCR</span>
                </>
              )}
              {state.status === 'requesting-permission' && (
                <>
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin mr-2" />
                  <span className="text-blue-400 text-sm font-medium">طلب الإذن</span>
                </>
              )}
              {state.status === 'permission-denied' && (
                <>
                  <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
                  <span className="text-red-400 text-sm font-medium">تم الرفض</span>
                </>
              )}
              {state.status === 'no-camera' && (
                <>
                  <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
                  <span className="text-red-400 text-sm font-medium">لا توجد كاميرا</span>
                </>
              )}
              {state.status === 'camera-busy' && (
                <>
                  <Zap className="w-4 h-4 text-yellow-400 mr-2" />
                  <span className="text-yellow-400 text-sm font-medium">مشغولة</span>
                </>
              )}
              {state.status === 'not-supported' && (
                <>
                  <AlertCircle className="w-4 h-4 text-red-400 mr-2" />
                  <span className="text-red-400 text-sm font-medium">غير مدعوم</span>
                </>
              )}
            </div>
          </div>

          {state.detectedCode && (
            <div className="mb-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg animate-pulse">
              <p className="text-slate-400 text-xs mb-1">رقم الكارت</p>
              <p className="text-green-400 font-mono text-lg" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{state.detectedCode}</p>
            </div>
          )}

          {state.ussdCode && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-slate-400 text-xs mb-1">كود USSD</p>
              <p className="text-blue-400 font-mono text-lg" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{state.ussdCode}</p>
            </div>
          )}

          {state.scanCount > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <p className="text-slate-500 text-xs">عدد الكروت المقروءة: <span className="text-green-400 font-semibold">{state.scanCount}</span></p>
            </div>
          )}
        </div>

        <div className="flex gap-3 mb-4">
          {state.ussdCode && state.status === 'success' && (
            <>
              <button
                onClick={handleCall}
                className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-all duration-300 shadow-lg shadow-green-500/50 active:scale-95"
                style={{ fontFamily: 'Poppins, sans-serif' }}
              >
                <Phone className="w-5 h-5 mr-2" />
                اتصل
              </button>
              <button
                onClick={handleCopy}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center transition-all duration-300 active:scale-95"
              >
                <Copy className="w-5 h-5 mr-2" />
                نسخ
              </button>
            </>
          )}
        </div>

        <div className="text-center text-slate-500 text-xs space-y-1">
          <p>🎯 وجّه الكاميرا نحو كارت الشحن</p>
          <p>✨ سيتم اكتشاف الرقم تلقائيًا</p>
          <p className="text-slate-600 text-xs mt-2">استخدم إضاءة جيدة للحصول على أفضل النتائج</p>
        </div>

        {state.diagnostics.length > 0 && (
          <div className="mt-6 bg-slate-900/50 border border-slate-700 rounded-lg p-3 max-h-48 overflow-y-auto">
            <p className="text-slate-400 text-xs font-semibold mb-2">📋 رسائل التشخيص:</p>
            <div className="space-y-1">
              {state.diagnostics.map((diag, index) => (
                <p key={index} className="text-slate-500 text-xs font-mono">{diag}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
