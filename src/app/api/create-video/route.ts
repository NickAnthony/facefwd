import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

// Type definitions for API responses
interface CaptionsSubmitResponse {
  operationId: string;
}

interface CaptionsPollResponse {
  state: 'COMPLETE' | 'FAILED' | 'PROCESSING';
  url?: string;
  error?: string;
}

interface UnscreenSubmitResponse {
  data: {
    links: {
      self: string;
    };
  };
}

interface UnscreenPollResponse {
  data: {
    attributes: {
      status: 'processing' | 'done';
      result_url?: string;
    };
  };
}

interface CreatomateResponse {
  url: string;
}

async function pollCaptionsResult(
  operationId: string,
  maxAttempts = 100,
  interval = 2000
): Promise<string> {
  console.log(`Starting Captions.ai polling for operationId: ${operationId}`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log(`Captions.ai poll attempt ${attempt + 1}/${maxAttempts}`);
    const pollRes = await axios.post<CaptionsPollResponse>(
      'https://api.captions.ai/api/creator/poll',
      { operationId },
      {
        headers: {
          'x-api-key': process.env.CAPTIONS_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Captions.ai poll response:', pollRes.data);

    // Check for completion with URL
    if (pollRes.data.state === 'COMPLETE' && pollRes.data.url) {
      console.log('Captions.ai video generation completed!');
      return pollRes.data.url;
    } else if (pollRes.data.state === 'FAILED') {
      console.error('Captions.ai video generation failed:', pollRes.data.error);
      throw new Error(pollRes.data.error || 'Video generation failed');
    }

    console.log('Waiting before next Captions.ai poll...');
    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Video generation timed out');
}

async function pollUnscreenResult(
  url: string,
  maxAttempts = 100,
  interval = 3000
): Promise<string> {
  console.log(`Starting Unscreen polling for URL: ${url}`);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log(`Unscreen poll attempt ${attempt + 1}/${maxAttempts}`);
    const pollRes = await axios.get<UnscreenPollResponse>(url, {
      headers: { 'X-Api-Key': process.env.UNSCREEN_API_KEY || '' },
    });

    console.log('Unscreen poll response:', pollRes.data);

    if (
      pollRes.data.data.attributes.status === 'done' &&
      pollRes.data.data.attributes.result_url
    ) {
      console.log('Unscreen background removal completed!');
      return pollRes.data.data.attributes.result_url;
    }

    console.log('Waiting before next Unscreen poll...');
    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('Background removal timed out');
}

async function downloadAndExtractUnscreenVideo(url: string): Promise<string> {
  // Create a unique directory for this request
  const tempDir = path.join(process.cwd(), 'temp', Date.now().toString());
  await fs.promises.mkdir(tempDir, { recursive: true });

  // Download the video file using curl
  const alphaVideoPath = path.join(tempDir, 'alpha.mp4');
  console.log('Downloading alpha video with curl...');
  await execAsync(
    `curl -L -H "X-Api-Key: ${process.env.UNSCREEN_API_KEY}" "${url}" -o "${alphaVideoPath}"`
  );
  console.log('Alpha video downloaded to:', alphaVideoPath);

  return alphaVideoPath;
}

async function processAlphaVideo(
  alphaPath: string,
  originalVideoPath: string
): Promise<string> {
  const outputPath = alphaPath.replace('alpha.mp4', 'transparent.mp4');

  // FFmpeg command to create a transparent video using the alpha channel
  // This assumes alpha.mp4 has white for the subject and black for transparency
  const command = `ffmpeg -i ${originalVideoPath} -i ${alphaPath} -filter_complex "[1:v]format=gray,geq=lum='p(X,Y)':a='if(gt(lum(X,Y),0),255,0)'[mask];[0:v][mask]alphamerge[out]" -map "[out]" -map 0:a -c:v libx264 -preset medium -crf 23 -c:a copy ${outputPath}`;

  try {
    await execAsync(command);
    return outputPath;
  } catch (error) {
    throw new Error(
      `FFmpeg processing failed: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

async function downloadBackgroundImage(
  url: string,
  tempDir: string
): Promise<string> {
  const backgroundPath = path.join(tempDir, 'background.jpg');
  console.log('Downloading background image...');

  try {
    // Use axios to download the image with proper error handling
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      validateStatus: (status) => status === 200,
    });

    // Write the image data to file
    await fs.promises.writeFile(backgroundPath, response.data);

    // Verify the file exists and has content
    const stats = await fs.promises.stat(backgroundPath);
    if (stats.size === 0) {
      throw new Error('Downloaded background image is empty');
    }

    console.log('Background image downloaded to:', backgroundPath);
    return backgroundPath;
  } catch (error) {
    console.error('Failed to download background image:', error);
    throw new Error(
      `Failed to download background image: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

async function compositeVideoWithBackground(
  videoPath: string,
  backgroundPath: string,
  outputPath: string
): Promise<void> {
  console.log('Compositing video with background...');

  // FFmpeg command to replace green background with the provided background image
  const command = `ffmpeg -loop 1 -i "${backgroundPath}" -i "${videoPath}" -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[bg];[1:v]chromakey=0x00FF00:0.1:0.2[video];[bg][video]overlay=(W-w)/2:(H-h)/2:format=auto" -c:v libx264 -preset medium -crf 23 -c:a copy -shortest "${outputPath}"`;

  try {
    const { stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      timeout: 30000, // 30 second timeout
    });

    if (stderr) {
      console.warn('FFmpeg warnings:', stderr);
    }

    console.log('Composited video created at:', outputPath);
  } catch (error) {
    console.error('FFmpeg error:', error);
    throw new Error(
      `Failed to composite video: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const script = formData.get('script') as string;
    const backgroundImageUrl = formData.get('backgroundImageUrl') as string;
    const creatorName = formData.get('creatorId') as string;

    console.log('script', script);
    console.log('backgroundImageUrl', backgroundImageUrl);
    console.log('creatorName', creatorName);

    if (!script || !backgroundImageUrl || !creatorName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // STEP 1: Generate Avatar Video from Captions.ai
    console.log('\n=== STEP 1: Generating Avatar Video with Captions.ai ===');
    console.log('Submitting video generation request...');
    let avatarVideoUrl = '';
    if (process.env.USE_CAPTIONS_API) {
      const videoSubmitRes = await axios.post<CaptionsSubmitResponse>(
        'https://api.captions.ai/api/creator/submit',
        {
          script,
          creatorName,
          resolution: 'fhd',
        },
        {
          headers: {
            'x-api-key': process.env.CAPTIONS_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );

      // Poll for the video generation result
      avatarVideoUrl = await pollCaptionsResult(
        videoSubmitRes.data.operationId
      );
    } else {
      avatarVideoUrl =
        'https://storage.googleapis.com/captions-avatar-orc/orc/studio/writer__ugc_variant_result/RdGmgWUIohzYK2YlDlXw/824159dc-a9fd-4e54-90a2-3c1e2ac0b7c6/hd_result.mp4?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=cloud-run-captions-server%40captions-f6de9.iam.gserviceaccount.com%2F20250409%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20250409T011851Z&X-Goog-Expires=604800&X-Goog-SignedHeaders=host&X-Goog-Signature=3569d5f5d2a8f6188345e78a5279644ba4ef2adb99f94b50ca92c33ff0d1a5c3028e69d2fd5cb79f88c5c00ec7d3b89638aec989a26fa3816fd4f380fea8a80978a74e2f2fd49073bb335a9b3b78b1bb3c1f8e41cd81cb0fe8f4df29cae50a9a2da9306265633c19ebddd69bd0d39e928e26472d1254c73ae27b9e077174448df14f4056723d3916fb65bf6659cea36265b3565e80ee714edbedfd19242b3b4e2861da6f9454a7f45243cb6012f429b9454c03fd2fd43438a67c9c6a5b4fa30dca3c9b2715815a0d21baa3c56e51bd2dcd1df86c703c6f18997843752c6e987c0e6f2575c24ed76f3efc8993cbe2bb36d3a567679d8135b620859357dcf6a960';
    }
    console.log('Avatar video URL:', avatarVideoUrl);

    // STEP 2: Remove background using Unscreen
    console.log('\n=== STEP 2: Removing Background with Unscreen ===');
    console.log('Submitting background removal request...');
    let unscreenResultUrl = '';
    if (process.env.USE_UNSCREEN_API) {
      const unscreenFormData = new FormData();
      unscreenFormData.append('video_url', avatarVideoUrl);
      unscreenFormData.append('format', 'mp4');
      unscreenFormData.append('background_color', '00FF00');

      const unscreenSubmitRes = await axios
        .post<UnscreenSubmitResponse>(
          'https://api.unscreen.com/v1.0/videos',
          unscreenFormData,
          {
            headers: {
              'X-Api-Key': process.env.UNSCREEN_API_KEY || '',
              ...unscreenFormData.getHeaders(),
            },
          }
        )
        .catch((error) => {
          console.error('Unscreen API Error:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers,
          });
          throw error;
        });

      // Poll for the background removal result
      unscreenResultUrl = await pollUnscreenResult(
        unscreenSubmitRes.data.data.links.self
      );
      console.log('Unscreen result URL:', unscreenResultUrl);
    } else {
      unscreenResultUrl =
        'https://storage.googleapis.com/unscreen/unscreen/uploads/variant_video/90adf86e-98fc-40fe-a4b7-61bab805f3b0/video.mp4';
    }

    // Create temporary directory
    console.log('\n=== STEP 2.1: Processing Results ===');
    console.log('Creating temporary directory...');
    const tempDir = path.join(process.cwd(), 'temp', Date.now().toString());
    await fs.promises.mkdir(tempDir, { recursive: true });

    // Download the transparent video from Unscreen
    console.log('Downloading transparent video...');
    const transparentVideoPath = path.join(tempDir, 'transparent.mp4');
    await execAsync(
      `curl -L -H "X-Api-Key: ${process.env.UNSCREEN_API_KEY}" "${unscreenResultUrl}" -o "${transparentVideoPath}"`
    );

    // Download the background image
    console.log('\n=== STEP 2.2: Downloading Background Image ===');
    const backgroundPath = await downloadBackgroundImage(
      backgroundImageUrl,
      tempDir
    );

    // Composite the video with the background
    console.log('\n=== STEP 2.3: Compositing Video with Background ===');
    const finalVideoPath = path.join(tempDir, 'final.mp4');
    await compositeVideoWithBackground(
      transparentVideoPath,
      backgroundPath,
      finalVideoPath
    );

    // Upload the final video to a storage service or return the local path
    // For now, we'll return the local path
    console.log('\n=== PROCESS COMPLETE ===');
    console.log('Final video created at:', finalVideoPath);

    return NextResponse.json({ finalVideoPath });
  } catch (error) {
    console.error('\n=== PROCESS FAILED ===');
    console.error('Video generation failed:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Video generation failed',
      },
      { status: 500 }
    );
  }
}
