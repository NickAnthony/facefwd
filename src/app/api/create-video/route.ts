import { NextResponse } from 'next/server';
import axios from 'axios';
// import { v4 as uuidv4 } from 'uuid'; // uuidv4 is not used in the provided logic

// Note: formidable and fs are not needed in App Router for basic form data handling
// import formidable, { File } from 'formidable';
// import fs from 'fs';

// No need for config export in App Router
// export const config = {
//   api: {
//     bodyParser: false,
//   },
// };

// Define expected response types for better type safety (Optional but recommended)
// interface CaptionsSubmitResponse { ... }
// interface CaptionsPollResponse { ... }

// Remove Cutout.pro interfaces
// interface CutoutSubmitResponse { ... }
// interface CutoutStatusResponse { ... }

// Add Unscreen Interfaces
interface UnscreenVideoAttributes {
  status: 'queued' | 'processing' | 'done' | 'error';
  progress?: number;
  error?: { title: string; detail?: string; code?: string };
  result_url?: string; // URL to the output file (e.g., pro_bundle zip)
  source_url?: string;
  file_name?: string;
  format?: string;
}

interface UnscreenSubmitResponse {
  data: {
    type: string;
    id: string; // Video ID needed for polling
    attributes: UnscreenVideoAttributes;
    links: { self: string };
  };
}

interface UnscreenStatusResponseData {
  type: string;
  id: string;
  attributes: UnscreenVideoAttributes;
  links: { self: string };
}

interface UnscreenStatusResponse {
  data: UnscreenStatusResponseData;
}

interface CreatomateResponse {
  url: string; // Adjust if Creatomate uses polling/IDs
}

interface CaptionsEditResponse {
  video_url: string;
}

// --- Minimal Interfaces for Error Handling ---
interface PotentialResponseData {
  message?: string;
  error?: string | { title: string; detail?: string; code?: string }; // Allow string or Unscreen error object
  msg?: string;
  // Add other potential common fields if known
}

interface PotentialAxiosError extends Error {
  isAxiosError: true; // Check for this specific flag
  response?: {
    data?: unknown; // Keep data unknown initially
    status?: number;
    statusText?: string;
  };
  config?: {
    method?: string;
    url?: string;
    headers?: Record<string, string | number | boolean>; // More specific than any
  };
  code?: string;
}

// --- Type Guard for our PotentialAxiosError structure ---
function isPotentialAxiosError(error: unknown): error is PotentialAxiosError {
  if (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error && // Check property existence first
    error.isAxiosError === true && // Access property directly after check
    'response' in error &&
    'config' in error &&
    'message' in error
  ) {
    // Add checks for nested properties if needed for more robustness
    return true;
  }
  return false;
}

// --- Polling Configuration ---
const POLLING_INTERVAL_MS = 5000; // Check every 5 seconds
const POLLING_TIMEOUT_MS = 300000; // Timeout after 5 minutes

// --- Helper for Polling ---
async function pollUntilDone<ResultType, StatusResponseType>(
  checkStatusFn: () => Promise<StatusResponseType>,
  getStatusFromResult: (res: StatusResponseType) => string | undefined,
  getResultUrlFromResult: (res: StatusResponseType) => ResultType | undefined,
  getErrorMessageFromResult: (res: StatusResponseType) => string | undefined,
  successStatus: string = 'done',
  failureStatusPrefix: string = 'fail' // Handle 'failed', 'failure' etc.
): Promise<ResultType> {
  const startTime = Date.now();
  while (Date.now() - startTime < POLLING_TIMEOUT_MS) {
    console.log(
      `Polling... Time elapsed: ${((Date.now() - startTime) / 1000).toFixed(
        0
      )}s`
    );
    try {
      const response = await checkStatusFn();
      const status = getStatusFromResult(response);
      const errorMessage = getErrorMessageFromResult(response);

      console.log(`  Current status: ${status}`);

      if (status === successStatus) {
        const resultUrl = getResultUrlFromResult(response);
        if (resultUrl) {
          console.log(`Polling successful. Result URL: ${resultUrl}`);
          return resultUrl;
        } else {
          throw new Error(
            `Polling succeeded (status: ${status}) but no result URL found.`
          );
        }
      } else if (status?.startsWith(failureStatusPrefix)) {
        throw new Error(
          `Polling failed with status: ${status}. Error: ${
            errorMessage || 'Unknown error'
          }`
        );
      }
      // Continue polling if status is neither success nor failure (e.g., 'running', 'processing')
    } catch (error) {
      // Log polling errors but continue polling unless it's a definitive failure status from the API
      console.error(
        'Polling attempt failed:',
        error instanceof Error ? error.message : error
      );
      if (
        error instanceof Error &&
        error.message.includes('Polling failed with status')
      ) {
        throw error; // Re-throw definitive API failure
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS));
  }
  throw new Error(
    `Polling timed out after ${POLLING_TIMEOUT_MS / 1000} seconds.`
  );
}

// --- Status Check Functions ---

// Unscreen: Check status of background removal
async function checkUnscreenStatus(
  videoId: string
): Promise<UnscreenStatusResponse> {
  const statusUrl = `https://api.unscreen.com/v1.0/videos/${videoId}`;
  console.log(
    `  Polling Unscreen status for videoId: ${videoId} at ${statusUrl}`
  );
  const response = await axios.get<UnscreenStatusResponse>(statusUrl, {
    headers: { 'X-Api-Key': `${process.env.UNSCREEN_API_KEY}` },
    validateStatus: (status) => status >= 200 && status < 300,
  });
  console.log(
    `  Unscreen poll response status: ${response.status}, data status:`,
    response.data?.data?.attributes?.status
  );
  return response.data; // Axios throws non-2xx, handled by polling catch
}

// --- Main API Route Handler ---
export async function POST(request: Request) {
  console.log('\n--- Received POST /api/create-video ---');
  try {
    const formData = await request.formData();
    const script = formData.get('script') as string | null;
    const backgroundImageUrl = formData.get('backgroundImageUrl') as
      | string
      | null;
    const creatorId = formData.get('creatorId') as string | null; // Corresponds to creatorName

    console.log('Input Data:', {
      script: script?.substring(0, 50) + '...',
      backgroundImageUrl,
      creatorId,
    });

    // Basic validation
    if (!script || !backgroundImageUrl || !creatorId) {
      console.error('Validation Failed: Missing required fields.');
      return NextResponse.json(
        {
          error:
            'Missing required fields: script, backgroundImageUrl, creatorId',
        },
        { status: 400 }
      );
    }
    if (
      !process.env.CAPTIONS_API_KEY ||
      !process.env.UNSCREEN_API_KEY ||
      !process.env.CREATOMATE_API_KEY
    ) {
      console.error(
        'Validation Failed: Missing one or more API keys in environment variables.'
      );
      return NextResponse.json(
        { error: 'Server configuration error: API key missing.' },
        { status: 500 }
      );
    }

    // --- STEP 1: Submit to Captions.ai & Poll for Avatar Video ---
    // Step 1 is currently hardcoded/commented out by user
    const avatarVideoUrl =
      'https://storage.googleapis.com/captions-avatar-orc/orc/studio/writer__ugc_result/6E7p6Upm6BxBPnBi91Al/be31642e-961c-41f7-ad90-7ca35710bc1a/result.mp4?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Credential=cloud-run-captions-server%40captions-f6de9.iam.gserviceaccount.com%2F20250409%2Fauto%2Fstorage%2Fgoog4_request&X-Goog-Date=20250409T001741Z&X-Goog-Expires=604800&X-Goog-SignedHeaders=host&X-Goog-Signature=36d892cae630576b28d3b37e949ff7bb6bcb7eff9d1f1f66c97a540b60b9902d65d615c615ebc5350413f143b7c31da5656be25aa712c5e9eef26034304033827336b843bfeba874bbc363059ad80ac4895808c3631baccf494ae66201e01e6cd5f4a95baf8ed1228eab3c0c03562ade4f61954cedf3efc15946ce53134f02febc6c53d53bf7a5d36f88018332b64e6aa82b3de9d128cc07f2c66c983076d339309000e2905053fff3bc709652508990140990816ebde2a023bada733aef12edd2f33f37ab5c4b4e5f6d37f68df908abb5859d7be2a443bd985b310e87f56d5fe7a6c0f53701b1d914504e36203ec38b8f30cb81ad95d1f0fdb179f54a748f51';
    console.log(`Step 1 Complete. Using hardcoded Avatar Video URL.`);

    // --- STEP 2: Submit to Unscreen & Poll for Background Removal Result ---
    console.log('\n--- Step 2: Submitting to Unscreen... ---');

    // Try sending as application/x-www-form-urlencoded
    const unscreenSubmitData = new URLSearchParams();
    unscreenSubmitData.append('video_url', avatarVideoUrl);
    // Specify format if needed, e.g.:
    // unscreenSubmitData.append('format', 'webm');

    const unscreenSubmitRes = await axios.post<UnscreenSubmitResponse>(
      'https://api.unscreen.com/v1.0/videos',
      unscreenSubmitData.toString(), // Send as URL encoded string
      {
        headers: {
          // Set appropriate content type
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Api-Key': `${process.env.UNSCREEN_API_KEY}`,
        },
      }
    );

    const unscreenVideoId = unscreenSubmitRes.data?.data?.id;
    if (!unscreenVideoId) {
      throw new Error(
        'Unscreen submission succeeded but failed to get video ID.'
      );
    }
    console.log(`Unscreen job submitted. Video ID: ${unscreenVideoId}`);

    console.log('Polling Unscreen for background removal status...');
    const unscreenResultUrl = await pollUntilDone<
      string,
      UnscreenStatusResponse
    >(
      () => checkUnscreenStatus(unscreenVideoId),
      (res) => res.data?.attributes?.status, // Get status
      (res) => res.data?.attributes?.result_url, // Get result url
      (res) => res.data?.attributes?.error?.title, // Get error title if status is error
      'done', // Success status
      'error' // Failure status prefix (matches Unscreen's 'error')
    );
    console.log(
      `Step 2 Complete. Unscreen Result URL received: ${unscreenResultUrl}`
    );
    console.warn(
      '!!! IMPORTANT: Unscreen result URL likely points to a pro_bundle ZIP file. Step 3 (Creatomate) expects a direct video URL and will likely fail without intermediate processing (unzip + ffmpeg) to create a transparent video (e.g., WEBM) from the pro_bundle. !!!'
    );
    const transparentVideoUrl = unscreenResultUrl; // Assigning for now, but needs processing

    // --- STEP 3: Composite with background using Creatomate ---
    console.log('\n--- Step 3: Submitting to Creatomate... ---');
    // !!! This step will likely FAIL because transparentVideoUrl is a ZIP file URL !!!
    const composition = await axios.post<CreatomateResponse>(
      'https://api.creatomate.com/v1/renders',
      {
        template: {
          output_format: 'mp4',
          dimensions: { width: 1080, height: 1920 },
          elements: [
            { type: 'image', src: backgroundImageUrl, position: 'center' },
            {
              type: 'video',
              src: transparentVideoUrl, // <<< THIS IS A ZIP URL FROM UNSCREEN
              position: 'center',
              fit: 'contain',
            },
          ],
        },
      },
      {
        headers: { Authorization: `Bearer ${process.env.CREATOMATE_API_KEY}` },
      }
    );
    const renderedVideoUrl = composition.data.url;
    console.log(
      `Step 3 Complete (but likely used invalid input). Rendered URL received.`
    );

    // --- STEP 4: Add captions using Captions.ai (AI Edit API) ---
    // Note: This might also be async and require polling!
    console.log('\n--- Step 4: Submitting to Captions.ai AI Edit... ---');
    const captionRes = await axios.post<CaptionsEditResponse>(
      'https://api.captions.ai/v1/ai-edit', // Confirm this endpoint and its behavior (sync/async)
      {
        video_url: renderedVideoUrl,
        features: {
          add_captions: { language: 'en' },
        },
      },
      {
        // Verify auth method for AI Edit API - might be x-api-key?
        // Might also need Content-Type: application/json
        headers: { Authorization: `Bearer ${process.env.CAPTIONS_API_KEY}` },
      }
    );
    // Assuming direct URL return for simplicity. Confirm in docs.
    const finalVideoUrl = captionRes.data.video_url;
    console.log(
      `Step 4 Complete. Final Video URL with captions: ${finalVideoUrl}`
    );

    console.log(
      '\n--- Video Creation Pipeline Finished (with potential errors in Step 3) ---'
    );
    return NextResponse.json({ finalVideoUrl: finalVideoUrl });
  } catch (error: unknown) {
    console.error('\n--- ERROR DURING VIDEO CREATION PIPELINE ---');
    let errorMessage = 'Video generation failed';
    let status = 500;

    // Use the custom type guard
    if (isPotentialAxiosError(error)) {
      const responseData = error.response?.data;
      const responseStatus = error.response?.status;

      // Log the responseData stringified to see nested errors
      let responseDataString = '';
      try {
        responseDataString = JSON.stringify(responseData, null, 2); // Pretty print
      } catch {
        responseDataString = '[Could not stringify response data]';
      }

      console.error('Axios Error Details:', {
        message: error.message,
        code: error.code,
        status: responseStatus,
        // Log the stringified version to see details
        responseDataString: responseDataString,
        requestConfig: {
          // Log relevant config safely
          method: error.config?.method,
          url: error.config?.url,
          headers: '***',
        },
      });

      // Extract error message (existing logic)
      let apiErrorMessage: string | undefined;
      if (typeof responseData === 'object' && responseData !== null) {
        const potentialData = responseData as PotentialResponseData;
        const specificError = potentialData.error;
        if (
          typeof specificError === 'object' &&
          specificError !== null &&
          'title' in specificError
        ) {
          apiErrorMessage = `${specificError.title}${
            specificError.detail ? ': ' + specificError.detail : ''
          }`;
        } else {
          apiErrorMessage =
            potentialData.message ||
            (typeof specificError === 'string' ? specificError : undefined) ||
            potentialData.msg;
        }
      }
      errorMessage =
        apiErrorMessage || error.message || 'An API request failed.';
      status = responseStatus || 500;
    } else if (error instanceof Error) {
      // Handle standard JavaScript errors
      errorMessage = error.message;
      console.error(`Standard Error: ${error.name} - ${errorMessage}`);
      console.error(error.stack); // Log stack trace for debugging
    } else {
      // Handle non-Error objects thrown
      console.error('Unknown Error Structure:', error);
      errorMessage = 'An unexpected error occurred.';
    }

    // Return a standardized error response
    console.error(
      `Pipeline failed. Returning status ${status} with message: "${errorMessage}"`
    );
    return NextResponse.json({ error: errorMessage }, { status: status });
  }
}
