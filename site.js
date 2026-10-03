(() => {
  // Configuration
  const TARGET_DIMENSION = 2000;
  const PROCESS_PIXEL_EVERY = 3;
  const MIN_IMAGE_DIMENSION = 4;
  const MIN_TILE_SIZE = 4;
  const MAX_TILE_SIZE = 128;
  const MAX_DIVISIONS_PER_AXIS = Math.floor(TARGET_DIMENSION / MIN_TILE_SIZE);
  const MIN_IMAGE_SIZE_MESSAGE = `Image must be at least ${MIN_IMAGE_DIMENSION} × ${MIN_IMAGE_DIMENSION} pixels.`;

  // DOM references
  const fileElm = document.getElementById('file');
  const countElm = document.getElementById('count');
  const typeElm = document.getElementById('type');
  const imageElm = document.getElementById('image');
  const canvasElm = document.getElementById('canvas');
  const downloadElm = document.getElementById('download');

  // State
  const ctx = canvasElm.getContext('2d');
  const linkElm = document.createElement('a');
  let sourceImage = null;
  let sourceImageUrl = null;

  // Helpers
  const hasMinimumImageSize = (image) =>
    image.naturalWidth >= MIN_IMAGE_DIMENSION && image.naturalHeight >= MIN_IMAGE_DIMENSION;
  const releaseSourceImageUrl = () => {
    if (!sourceImageUrl) return;
    URL.revokeObjectURL(sourceImageUrl);
    sourceImageUrl = null;
  };
  const hideResult = () => {
    canvasElm.hidden = true;
    downloadElm.hidden = true;
    downloadElm.disabled = true;
  };
  const getTypeMap = (divSize) => {
    const getType = (x, y) => {
      const xInverse = divSize - x - 1;
      if (x === y && xInverse === y) return 'm';
      if (x === y) return xInverse > y ? 'tl' : 'br';
      if (xInverse === y) return x > y ? 'tr' : 'bl';
      if (x > y) return xInverse > y ? 't' : 'r';
      return xInverse > y ? 'l' : 'b';
    };

    const result = {};
    for (let x = 0; x < divSize; x++) {
      for (let y = 0; y < divSize; y++) {
        const type = getType(x, y);
        result[type] = result[type] || [];
        result[type].push([x, y]);
      }
    }
    return result;
  };
  const getDataIndex = (coordOffset, coord) => {
    const x = coordOffset[0] + coord[0];
    const y = coordOffset[1] + coord[1];
    return (x + y * canvasElm.width) * 4;
  };
  const avgRegionColor = (imgData, coordOffset, coords) => {
    let red = 0;
    let green = 0;
    let blue = 0;
    let sampleCount = 0;

    for (let i = 0; i < coords.length; i += PROCESS_PIXEL_EVERY) {
      const index = getDataIndex(coordOffset, coords[i]);
      const redValue = imgData.data[index];
      const greenValue = imgData.data[index + 1];
      const blueValue = imgData.data[index + 2];
      red += redValue ** 2;
      green += greenValue ** 2;
      blue += blueValue ** 2;
      sampleCount++;
    }

    return [
      Math.sqrt(red / sampleCount),
      Math.sqrt(green / sampleCount),
      Math.sqrt(blue / sampleCount)
    ];
  };
  const fillColor = (imgData, coordOffset, typeMap, colors) => {
    for (const type in typeMap) {
      const coords = typeMap[type];
      const color = colors[type];
      for (let i = 0; i < coords.length; i++) {
        const index = getDataIndex(coordOffset, coords[i]);
        imgData.data[index] = color[0];
        imgData.data[index + 1] = color[1];
        imgData.data[index + 2] = color[2];
        imgData.data[index + 3] = 255;
      }
    }
  };
  const avgColor = (colors) => colors
    .reduce((acc, color) => {
      acc[0] += color[0] ** 2;
      acc[1] += color[1] ** 2;
      acc[2] += color[2] ** 2;
      return acc;
    }, [0, 0, 0])
    .map((value) => Math.sqrt(value / colors.length));
  const colorDistanceSquared = (color1, color2) => {
    const redDifference = color1[0] - color2[0];
    const greenDifference = color1[1] - color2[1];
    const blueDifference = color1[2] - color2[2];
    return redDifference ** 2 + greenDifference ** 2 + blueDifference ** 2;
  };

  // Primary function
  const processImage = () => {
    if (!sourceImage) return;

    try {
      const divCount = Math.floor(countElm.value);
      const simplify = typeElm.value === '2';
      const imgWidth = sourceImage.naturalWidth;
      const imgHeight = sourceImage.naturalHeight;
      const imgArea = imgWidth * imgHeight;
      const oriDivSize = Math.max(
        1,
        Math.floor(Math.sqrt(imgArea / divCount)),
        Math.ceil(Math.max(imgWidth, imgHeight) / MAX_DIVISIONS_PER_AXIS)
      );
      const divColCount = Math.max(1, Math.floor(imgWidth / oriDivSize));
      const divRowCount = Math.max(1, Math.floor(imgHeight / oriDivSize));
      const divSize = Math.max(
        MIN_TILE_SIZE,
        Math.min(MAX_TILE_SIZE, Math.floor(TARGET_DIMENSION / Math.max(divColCount, divRowCount)))
      );
      const resultWidth = divColCount * divSize;
      const resultHeight = divRowCount * divSize;
      const scale = Math.max(resultWidth / imgWidth, resultHeight / imgHeight);
      const sourceWidth = resultWidth / scale;
      const sourceHeight = resultHeight / scale;
      const sourceX = (imgWidth - sourceWidth) / 2;
      const sourceY = (imgHeight - sourceHeight) / 2;
      canvasElm.width = resultWidth;
      canvasElm.height = resultHeight;
      ctx.drawImage(
        sourceImage,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        resultWidth,
        resultHeight
      );

      const imgData = ctx.getImageData(0, 0, resultWidth, resultHeight);
      const typeMap = getTypeMap(divSize);
      for (let i = 0; i < divColCount; i++) {
        for (let j = 0; j < divRowCount; j++) {
          const coordOffset = [i * divSize, j * divSize];
          const colors = {
            t: avgRegionColor(imgData, coordOffset, typeMap.t),
            r: avgRegionColor(imgData, coordOffset, typeMap.r),
            b: avgRegionColor(imgData, coordOffset, typeMap.b),
            l: avgRegionColor(imgData, coordOffset, typeMap.l)
          };
          colors.m = avgColor([colors.t, colors.r, colors.b, colors.l]);
          colors.tr = avgColor([colors.t, colors.r]);
          colors.tl = avgColor([colors.t, colors.l]);
          colors.br = avgColor([colors.b, colors.r]);
          colors.bl = avgColor([colors.b, colors.l]);

          if (simplify) {
            const distanceTrBl = colorDistanceSquared(colors.tr, colors.bl);
            const distanceTlBr = colorDistanceSquared(colors.tl, colors.br);
            if (distanceTrBl < distanceTlBr) {
              colors.t = colors.l = colors.tl;
              colors.b = colors.r = colors.br;
              colors.tr = colors.bl = colors.m;
            } else {
              colors.t = colors.r = colors.tr;
              colors.b = colors.l = colors.bl;
              colors.tl = colors.br = colors.m;
            }
          }

          fillColor(imgData, coordOffset, typeMap, colors);
        }
      }

      ctx.putImageData(imgData, 0, 0);
      canvasElm.hidden = false;
      downloadElm.hidden = false;
      downloadElm.disabled = false;
    } catch (error) {
      hideResult();
      alert(error.message || 'Unable to process this image. Try a different image.');
    }
  };

  // Event handlers
  const handleFileChange = () => {
    const file = fileElm.files && fileElm.files[0];
    if (!file) return;

    releaseSourceImageUrl();
    sourceImage = null;
    imageElm.hidden = true;
    imageElm.removeAttribute('src');
    hideResult();
    fileElm.value = '';

    if (file.type && !file.type.startsWith('image/')) {
      alert('Choose an image file supported by your browser.');
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    sourceImageUrl = imageUrl;
    imageElm.onload = () => {
      if (sourceImageUrl !== imageUrl) return;
      if (!hasMinimumImageSize(imageElm)) {
        releaseSourceImageUrl();
        alert(MIN_IMAGE_SIZE_MESSAGE);
        return;
      }

      sourceImage = imageElm;
      imageElm.hidden = false;
      processImage();
    };
    imageElm.onerror = () => {
      if (sourceImageUrl !== imageUrl) return;
      releaseSourceImageUrl();
      alert('Unable to load this image. Choose a supported image file and try again.');
    };
    imageElm.src = imageUrl;
  };
  const handleDownload = () => {
    if (downloadElm.disabled) return;
    canvasElm.toBlob((blob) => {
      if (!blob) {
        alert('Unable to create the download. Try processing the image again.');
        return;
      }

      const downloadUrl = URL.createObjectURL(blob);
      linkElm.href = downloadUrl;
      linkElm.download = 'Pixela.jpg';
      linkElm.click();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }, 'image/jpeg');
  };

  // Event bindings
  fileElm.addEventListener('change', handleFileChange);
  countElm.addEventListener('change', processImage);
  typeElm.addEventListener('change', processImage);
  downloadElm.addEventListener('click', handleDownload);
})();
