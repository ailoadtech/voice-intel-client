
import { pipeline, env } from '@xenova/transformers';

// Skip local model checks since we are in browser
env.allowLocalModels = false;

// Interface for the singleton
class PipelineSingleton {
    static task = 'automatic-speech-recognition' as const;
    static model = 'Xenova/whisper-tiny';
    static instance: any = null;

    static async getInstance(progress_callback: any = null) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, {
                progress_callback,
                // Force fp32 for broader compatibility
                dtype: {
                    encoder_model: 'fp32',
                    decoder_model_merged: 'fp32',
                },
            } as any);
        }
        return this.instance;
    }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event: any) => {
    const { type, audio, id } = event.data;

    if (type === 'transcribe') {
        try {
            // Send loading status
            self.postMessage({ type: 'status', status: 'loading', id });

            const transcriber = await PipelineSingleton.getInstance((data: any) => {
                // You can relay download progress here if you want
                // self.postMessage({ type: 'download_progress', data, id });
            });

            self.postMessage({ type: 'status', status: 'transcribing', id });

            // Run transcription
            const output = await transcriber(audio, {
                top_k: 0,
                do_sample: false,
                chunk_length_s: 30,
                stride_length_s: 5,
                language: 'german',
                task: 'transcribe',
                return_timestamps: false, // Simple text for now
            });

            self.postMessage({
                type: 'complete',
                text: output.text,
                id
            });
        } catch (error) {
            console.error(error);
            self.postMessage({ type: 'error', error: String(error), id });
        }
    }
});
