// 保留文件以兼容旧逻辑；实际切换已由 background 注入的 togglePipInPage 完成。
(function () {
  function findLargestPlayingVideo() {
    return Array.from(document.querySelectorAll("video"))
      .filter((video) => video.readyState != 0)
      .filter((video) => video.disablePictureInPicture == false)
      .sort((v1, v2) => {
        const v1Rect = v1.getClientRects()[0] || { width: 0, height: 0 };
        const v2Rect = v2.getClientRects()[0] || { width: 0, height: 0 };
        return v2Rect.width * v2Rect.height - v1Rect.width * v1Rect.height;
      })[0];
  }

  if (document.pictureInPictureElement) {
    document.exitPictureInPicture();
    return;
  }

  const video = findLargestPlayingVideo();
  if (!video) return;
  if (video.paused) video.play().catch(() => {});
  video.requestPictureInPicture().catch((error) => {
    console.warn("PiP failed:", error);
  });
})();
