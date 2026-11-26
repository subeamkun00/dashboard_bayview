type UploadResult = {
  id: string;
  message: string;
  processing_status: string;
};

export function uploadWithProgress(
  form: FormData,
  onProgress: (progress: number | null) => void,
) {
  return new Promise<UploadResult>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/documents");
    request.responseType = "json";
    request.timeout = 120000;
    request.upload.onprogress = (event) =>
      onProgress(
        event.lengthComputable && event.total > 0
          ? Math.round((event.loaded / event.total) * 100)
          : null,
      );
    request.onload = () => {
      const result = request.response;
      if (request.status >= 200 && request.status < 300 && result?.id)
        resolve(result);
      else
        reject(new Error(result?.error || "Upload failed. Please try again."));
    };
    const interrupted = () =>
      reject(
        new Error(
          "The upload connection was interrupted. Check the document list before retrying.",
        ),
      );
    request.onerror = interrupted;
    request.ontimeout = interrupted;
    request.onabort = interrupted;
    request.send(form);
  });
}
