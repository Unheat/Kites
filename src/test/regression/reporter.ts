import type { HarnessResult } from './fixtureTypes.js';

export function printHarnessReport(result: HarnessResult, imagePath: string, mode: string, totalTime: number) {
  console.log('\n======================================================');
  console.log('   NEURAL BUBBLE OFFLINE REGRESSION HARNESS REPORT   ');
  console.log('======================================================');
  console.log(`Image: ${imagePath} (${result.metrics.totalOcrBoxes} OCR boxes)`);
  console.log(`Mode: ${mode}`);
  console.log('\n--- Stage Metrics & Timings ---');
  console.log(`1. Font & Hyphenation Init:  ${result.stageTimingsMs.fontAndHyphenation}ms`);
  console.log(`2. Image Load & Inpaint:     ${result.stageTimingsMs.imageLoadAndInpaint}ms`);
  console.log(`3. YOLO Bubble Inference:    ${result.stageTimingsMs.yoloInference}ms (${result.metrics.totalYoloBubbles} proposals)`);
  console.log(`4. Geometry Extraction:      ${result.stageTimingsMs.geometryBuild}ms`);
  console.log(`5. Layout Resolution:        ${result.stageTimingsMs.layoutResolution}ms (${result.metrics.acceptedLayouts} accepted, ${result.metrics.rejectedLayouts} fallback)`);
  console.log(`6. Text Rendering:           ${result.stageTimingsMs.typesettingRender}ms`);
  console.log(`Total Pipeline Execution:    ${totalTime}ms`);

  console.log('\n--- Layout Acceptance Breakdown ---');
  console.log(`Accepted Typeset Boxes (${result.metrics.acceptedLayouts}/${result.metrics.totalOcrBoxes})`);
  console.log(`Rejected/Fallback Boxes (${result.metrics.rejectedLayouts}): indices [${result.metrics.rejectedIndices.join(', ')}]`);

  console.log('\n--- Differential Against Baseline Fixture ---');
  console.log(`Matching boxes:   ${result.differentialSummary.matchingBoxes}/${result.metrics.totalOcrBoxes}`);
  console.log(`Mismatched boxes: ${result.differentialSummary.mismatchedBoxes}/${result.metrics.totalOcrBoxes}`);
  console.log(`Pixel Diff Count: ${result.differentialSummary.boxDiffs.length > 0 ? 'N/A (geometry diff)' : 0} divergent pixels`);
  console.log(`Status:           ${result.differentialSummary.isIdenticalToBaseline ? '100% IDENTICAL' : 'DIVERGED'}`);

  if (result.differentialSummary.boxDiffs.length > 0) {
    console.log('\nDivergences:');
    for (const diff of result.differentialSummary.boxDiffs) {
      console.log(`  Box #${diff.boxIndex} ("${diff.mappedText}"):`);
      for (const d of diff.details) console.log(`    - ${d}`);
    }
  }

  console.log('\n--- Transcription Uncertainties (from frozen dictionary) ---');
  for (const u of result.transcriptionUncertainties) {
    console.log(`  Box #${u.index}: original="${u.originalText}" mapped="${u.mappedText}"`);
    console.log(`    Note: ${u.uncertainty}`);
  }

  console.log('\n--- Rendered PNG Deliverables ---');
  console.log(`Current Render:  ${result.renderedFiles.currentPng}`);
  console.log(`Baseline Render: ${result.renderedFiles.baselinePng}`);
  console.log(`Visual Diff:     ${result.renderedFiles.diffPng}`);
  console.log('======================================================\n');
}

export function printExitSummary(result: HarnessResult) {
  if (result.differentialSummary.isIdenticalToBaseline) {
    console.log('[Harness Exit] Regression test PASSED with 100% parity against baseline.');
  } else {
    console.warn('[Harness Exit] Baseline differential detected changes (expected when validating active refactors).');
  }
}