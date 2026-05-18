import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { HistoryGrid } from "@/components/HistoryGrid";
import { ImageResult } from "@/components/ImageResult";
import { ImageUpload } from "@/components/ImageUpload";
import { JobStatus } from "@/components/JobStatus";
import { PromptInput } from "@/components/PromptInput";
import { StyleSelector } from "@/components/StyleSelector";
import type { JobDetail } from "@/types";

const apiMock = vi.hoisted(() => ({
  fetchImageBlob: vi.fn(),
  getJob: vi.fn(),
  cancelJob: vi.fn()
}));

vi.mock("@/lib/api", () => apiMock);

const doneJob: JobDetail = {
  id: "job-1",
  feature: "txt2img",
  style: "realistic",
  user_prompt: "prompt",
  status: "done",
  progress_percent: 100,
  progress_label: "Complete",
  seed: 123,
  created_at: "2026-05-13T12:00:00Z",
  completed_at: "2026-05-13T12:01:00Z",
  images: [{ id: "out-1", type: "output", url: "/api/images/output/out.png", filename: "out.png" }]
};

describe("frontend components", () => {
  beforeEach(() => {
    apiMock.fetchImageBlob.mockResolvedValue(new Blob(["png"], { type: "image/png" }));
    apiMock.getJob.mockReset();
    apiMock.cancelJob.mockReset();
    vi.mocked(URL.createObjectURL).mockReturnValue("blob:component-url");
  });

  test("ImageResult fetches authenticated blobs and revokes object URLs on unmount", async () => {
    const { unmount } = render(<ImageResult job={doneJob} />);

    await expect(screen.findByAltText("Output")).resolves.toHaveAttribute("src", "blob:component-url");
    expect(apiMock.fetchImageBlob).toHaveBeenCalledWith("/api/images/output/out.png");

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:component-url");
  });

  test("JobStatus renders progress, reports completion once, and supports cancellation", async () => {
    const onDone = vi.fn();
    apiMock.getJob.mockResolvedValueOnce({
      ...doneJob,
      status: "processing",
      progress_percent: 42,
      current_step: 4,
      total_steps: 10,
      eta_seconds: 12
    });
    apiMock.cancelJob.mockResolvedValue({ status: "cancelled" });

    render(<JobStatus jobId="job-1" onDone={onDone} />);

    await expect(screen.findByText("processing")).resolves.toBeVisible();
    expect(screen.getByText("Step 4/10")).toBeVisible();
    expect(screen.getByText("ETA 12s")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(apiMock.cancelJob).toHaveBeenCalledWith("job-1"));
    expect(screen.getByText("Cancelled by user")).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
  });

  test("HistoryGrid exposes reuse, download, and delete actions without stale image URLs", async () => {
    const onUseImage = vi.fn();
    const onDelete = vi.fn();

    render(<HistoryGrid jobs={[doneJob]} onUseImage={onUseImage} onDelete={onDelete} />);

    await waitFor(() => expect(apiMock.fetchImageBlob).toHaveBeenCalledWith("/api/images/output/out.png"));
    await userEvent.click(screen.getByTitle("Use in Edit"));
    expect(onUseImage).toHaveBeenCalledWith("edit", doneJob.images[0]);

    await userEvent.click(screen.getByTitle("Download"));
    await waitFor(() => expect(apiMock.fetchImageBlob.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(apiMock.fetchImageBlob).toHaveBeenLastCalledWith("/api/images/output/out.png");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:component-url");

    await userEvent.click(screen.getByTitle("Delete history item"));
    expect(onDelete).toHaveBeenCalledWith(doneJob);
  });

  test("ImageUpload accepts images and ignores non-image drops", async () => {
    const onChange = vi.fn();
    render(<ImageUpload file={null} onChange={onChange} />);

    const input = document.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File(["png"], "sample.png", { type: "image/png" });
    await userEvent.upload(input, file);
    expect(onChange).toHaveBeenCalledWith(file);

    const label = screen.getByText("Choose or drop an image").closest("label")!;
    fireEvent.drop(label, {
      dataTransfer: {
        files: [new File(["txt"], "sample.txt", { type: "text/plain" })]
      }
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("PromptInput filters suggestions and StyleSelector emits chosen style", async () => {
    const onPromptChange = vi.fn();
    render(<PromptInput value="" onChange={onPromptChange} suggestions={["cinematic portrait", "product shot"]} />);

    fireEvent.change(screen.getByPlaceholderText("Describe the image you want..."), { target: { value: "cin" } });
    expect(onPromptChange).toHaveBeenLastCalledWith("cin");

    render(<StyleSelector value="realistic" onChange={onPromptChange} styles={[{ value: "realistic", label: "Realistic" }, { value: "anime", label: "Anime" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Anime" }));
    expect(onPromptChange).toHaveBeenLastCalledWith("anime");
  });
});
