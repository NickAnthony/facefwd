import { useState, FormEvent } from 'react';

export default function VideoCreatorForm() {
  const [script, setScript] = useState<string>('Hello this is nick');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string>(
    'https://www.reddit.com/media?url=https%3A%2F%2Fpreview.redd.it%2F7fnljtfflvse1.jpeg%3Fwidth%3D1080%26crop%3Dsmart%26auto%3Dwebp%26s%3D26206ddaf8866e449c95b6df103a7f7ab3026e5e'
  );
  const [creatorId, setCreatorId] = useState<string>('twin-1-Nick');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [result, setResult] = useState<{
    videoUrl?: string;
    error?: string;
  } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setResult(null);

    const formData = new FormData();
    formData.append('script', script);
    formData.append('backgroundImageUrl', backgroundImageUrl);
    formData.append('creatorId', creatorId);

    try {
      const response = await fetch('/api/create-video', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // Use the error message from the API response if available
        throw new Error(data.error || `HTTP error! status: ${response.status}`);
      }

      setResult({ videoUrl: data.finalVideoUrl });
    } catch (error: unknown) {
      console.error('Error calling create-video API:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred.';
      setResult({ error: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  // Basic inline styles for demonstration
  const styles = {
    container: {
      maxWidth: '600px',
      margin: '40px auto',
      padding: '20px',
      border: '1px solid #e0e0e0',
      borderRadius: '8px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    },
    formGroup: { marginBottom: '15px' },
    label: {
      display: 'block',
      marginBottom: '5px',
      fontWeight: 'bold' as 'bold',
    },
    input: {
      width: '100%',
      padding: '10px',
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxSizing: 'border-box' as 'border-box',
    },
    textarea: {
      width: '100%',
      padding: '10px',
      border: '1px solid #ccc',
      borderRadius: '4px',
      boxSizing: 'border-box' as 'border-box',
      minHeight: '100px',
    },
    button: {
      padding: '10px 20px',
      cursor: 'pointer',
      backgroundColor: '#0070f3',
      color: 'white',
      border: 'none',
      borderRadius: '4px',
      fontSize: '16px',
    },
    buttonDisabled: { backgroundColor: '#ccc', cursor: 'not-allowed' },
    resultBox: { marginTop: '20px', padding: '15px', borderRadius: '4px' },
    resultSuccess: { border: '1px solid green', backgroundColor: '#f0fff4' },
    resultError: { border: '1px solid red', backgroundColor: '#fff0f0' },
    errorText: { color: 'red' },
    link: { color: '#0070f3', textDecoration: 'underline' },
    loadingText: { marginTop: '15px', fontStyle: 'italic' as 'italic' },
  };

  return (
    <div style={styles.container}>
      <h1 style={{ textAlign: 'center', marginBottom: '20px' }}>
        Video Generation Service
      </h1>
      <form onSubmit={handleSubmit}>
        <div style={styles.formGroup}>
          <label htmlFor="creatorId" style={styles.label}>
            Creator ID:
          </label>
          <input
            type="text"
            id="creatorId"
            value={creatorId}
            onChange={(e) => setCreatorId(e.target.value)}
            required
            style={styles.input}
            placeholder="Enter the Captions.ai creator ID"
          />
        </div>
        <div style={styles.formGroup}>
          <label htmlFor="script" style={styles.label}>
            Script:
          </label>
          <textarea
            id="script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            required
            style={styles.textarea}
            placeholder="Enter the video script here..."
          />
        </div>
        <div style={styles.formGroup}>
          <label htmlFor="backgroundImageUrl" style={styles.label}>
            Background Image URL:
          </label>
          <input
            type="url"
            id="backgroundImageUrl"
            value={backgroundImageUrl}
            onChange={(e) => setBackgroundImageUrl(e.target.value)}
            required
            style={styles.input}
            placeholder="https://example.com/image.jpg"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          style={{
            ...styles.button,
            ...(isLoading ? styles.buttonDisabled : {}),
          }}
        >
          {isLoading ? 'Generating...' : 'Generate Video'}
        </button>
      </form>

      {isLoading && (
        <p style={styles.loadingText}>Generating video, please wait...</p>
      )}

      {result && (
        <div
          style={{
            ...styles.resultBox,
            ...(result.error ? styles.resultError : styles.resultSuccess),
          }}
        >
          {result.videoUrl && (
            <div>
              <p>
                <strong>Video created successfully!</strong>
              </p>
              <p>
                Final Video URL:{' '}
                <a
                  href={result.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  {result.videoUrl}
                </a>
              </p>
              {/* Optional: Add a video player */}
              {/* <video width="100%" controls style={{ marginTop: '10px' }}>
                <source src={result.videoUrl} type="video/mp4" />
                Your browser does not support the video tag.
              </video> */}
            </div>
          )}
          {result.error && (
            <div>
              <p style={styles.errorText}>
                <strong>Error:</strong>
              </p>
              <p style={styles.errorText}>{result.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
