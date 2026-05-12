@echo off
setlocal
chcp 65001 >nul

set DIR=%~dp0
set NORM=%DIR%normalized

echo ============================================
echo  CTS Reel 1 - Auto Assembly
echo ============================================

mkdir "%NORM%" 2>nul

echo.
echo [1/9] F1 - 角楼黎明 (6s)...
ffmpeg -y -i "%DIR%video1.mp4" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N1.mp4"

echo.
echo [2/9] F2 - 太和殿人潮 (trim 2s)...
ffmpeg -y -i "%DIR%Video2.mp4" -t 2 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N2.mp4"

echo.
echo [3/9] F3 - 剪影群体 (5s)...
ffmpeg -y -i "%DIR%Video3.mp4" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N3.mp4"

echo.
echo [4/9] F4 - 专家指引 (4s)...
ffmpeg -y -i "%DIR%Video4.mp4" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N4.mp4"

echo.
echo [5/9] F5a - 琉璃瓦 (trim 2s)...
ffmpeg -y -i "%DIR%Video5a.mp4" -t 2 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N5a.mp4"

echo.
echo [6/9] F5b - 龙纹石雕 (trim 2s)...
ffmpeg -y -i "%DIR%Video5b.mp4" -t 2 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N5b.mp4"

echo.
echo [7/9] F5c - 门环铺首 (trim 1.5s)...
ffmpeg -y -i "%DIR%Video5c.mp4" -t 1.5 -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N5c.mp4"

echo.
echo [8/9] F6 - 御花园 (5s)...
ffmpeg -y -i "%DIR%Video6.mp4" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N6.mp4"

echo.
echo [9/9] F7 - 太和殿全景 (4s)...
ffmpeg -y -i "%DIR%Video7.mp4" -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -an "%NORM%\N7.mp4"

echo.
echo 生成拼接列表...
(
echo file 'N1.mp4'
echo file 'N2.mp4'
echo file 'N3.mp4'
echo file 'N4.mp4'
echo file 'N5a.mp4'
echo file 'N5b.mp4'
echo file 'N5c.mp4'
echo file 'N6.mp4'
echo file 'N7.mp4'
) > "%NORM%\concat.txt"

echo.
echo 拼接所有片段...
ffmpeg -y -f concat -safe 0 -i "%NORM%\concat.txt" -c copy "%DIR%assembled_reel1_raw.mp4"

echo.
echo ============================================
echo  完成！输出文件：
echo  %DIR%assembled_reel1_raw.mp4
echo  总时长约 31.5 秒
echo ============================================
pause
