import { Router } from "express";
import {
  createDemoData,
  deleteDemoData,
  DemoDataAlreadyExistsError,
  DemoDataInUseError,
  getDemoDataStatus,
  resetDemoData
} from "../demo-data.js";

export const demoDataRouter = Router();

demoDataRouter.use((request, response, next) => {
  // Die Antworten beim Anlegen und Zurücksetzen enthalten einmalig sichtbare
  // Startkennwörter und dürfen deshalb weder im Browser noch in Proxys landen.
  response.set("Cache-Control", "no-store");
  if (!request.principal?.canManageAccounts) {
    response.status(403).json({
      error: "FORBIDDEN",
      message: "Nur das Masterkonto darf Demodaten verwalten."
    });
    return;
  }
  next();
});

demoDataRouter.get("/", async (_request, response, next) => {
  try {
    response.json(await getDemoDataStatus());
  } catch (error) {
    next(error);
  }
});

demoDataRouter.post("/", async (request, response, next) => {
  try {
    response.status(201).json(await createDemoData(request.principal!.appUserId));
  } catch (error) {
    if (error instanceof DemoDataAlreadyExistsError) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    if (error instanceof DemoDataInUseError) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});

demoDataRouter.post("/reset", async (request, response, next) => {
  try {
    response.json(await resetDemoData(request.principal!.appUserId));
  } catch (error) {
    if (error instanceof DemoDataInUseError) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});

demoDataRouter.post("/delete", async (request, response, next) => {
  try {
    response.json(await deleteDemoData(request.principal!.appUserId));
  } catch (error) {
    if (error instanceof DemoDataInUseError) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});
