import React, { useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';

const ImageCropper = ({ src, onCropComplete, onCancel }) => {
  const [crop, setCrop] = useState({
    unit: '%',
    width: 50,
    height: 50,
    x: 25,
    y: 25,
  });
  const [completedCrop, setCompletedCrop] = useState(null);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  const onImageLoad = (e) => {
    imgRef.current = e.target;
    // console.log('Image loaded:', e.target);
  };

  const makeClientCrop = useCallback(async (crop) => {
    if (imgRef.current && crop.width && crop.height) {
      const croppedImageUrl = await getCroppedImg(
        imgRef.current,
        crop,
        'newFile.jpeg'
      );
      return croppedImageUrl;
    }
  }, []);

  const getCroppedImg = (image, crop, fileName) => {
    const canvas = canvasRef.current;
    // console.log('getCroppedImg called with:', { image, crop, canvas });
    
    if (!canvas) {
      throw new Error('Canvas not available');
    }
    
    if (!image) {
      throw new Error('Image not available');
    }
    
    // التحقق من أن image هو HTML element صالح
    if (!(image instanceof HTMLImageElement)) {
      // console.error('Invalid image type:', image);
      throw new Error('Image is not a valid HTMLImageElement');
    }
    
    // التأكد من أن الصورة محملة
    if (!image.complete || !image.naturalWidth) {
      throw new Error('Image not fully loaded');
    }
    
    // التأكد من أن القص صالح
    if (!crop.width || !crop.height || crop.width <= 0 || crop.height <= 0) {
      throw new Error('Invalid crop dimensions');
    }
    
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    
    // تحديد أبعاد الكانفاس
    const pixelCrop = {
      x: crop.x * scaleX,
      y: crop.y * scaleY,
      width: crop.width * scaleX,
      height: crop.height * scaleY,
    };
    
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D context');
    }

    // مسح الكانفاس أولاً
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas is empty'));
          return;
        }
        blob.name = fileName;
        const croppedImageUrl = window.URL.createObjectURL(blob);
        resolve({ blob, url: croppedImageUrl });
      }, 'image/jpeg', 0.95);
    });
  };

  const handleCropComplete = async () => {
    // console.log('Crop button clicked', { completedCrop, hasImage: !!imgRef.current });
    
    if (completedCrop && imgRef.current) {
      try {
        // console.log('Starting crop with:', completedCrop);
        const result = await makeClientCrop(completedCrop);
        // console.log('Crop result:', result);
        
        if (result) {
          onCropComplete(result);
        }
      } catch (error) {
        console.error('Error cropping image:', error);
        alert(`حدث خطأ أثناء قص الصورة: ${error.message}`);
      }
          } else {
        // console.log('Cannot crop: missing data', { 
        //   hasCompletedCrop: !!completedCrop, 
        //   hasImage: !!imgRef.current 
        // });
      }
  };

  return (
    <div className="image-cropper-modal">
      <div className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <h3>قص الصورة</h3>
            <button className="close-btn" onClick={onCancel}>
              ×
            </button>
          </div>
          
          <div className="crop-container">
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={1} // مربع الشكل
              circularCrop={true} // قص دائري
            >
              <img
                ref={imgRef}
                alt="Crop me"
                src={src}
                style={{ 
                  maxHeight: '70vh', 
                  maxWidth: '100%',
                  display: 'block'
                }}
                onLoad={onImageLoad}
                crossOrigin="anonymous"
              />
            </ReactCrop>
          </div>

          <div className="crop-controls">
            <button 
              className="btn btn-secondary" 
              onClick={onCancel}
            >
              إلغاء
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleCropComplete}
              disabled={!completedCrop || !imgRef.current}
            >
              حفظ الصورة
            </button>
          </div>

          <canvas
            ref={canvasRef}
            style={{ display: 'none' }}
          />
        </div>
      </div>


    </div>
  );
};

ImageCropper.propTypes = {
  src: PropTypes.string.isRequired,
  onCropComplete: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
};

export default ImageCropper; 