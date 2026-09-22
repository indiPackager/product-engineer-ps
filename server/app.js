import express from "express";

export function createApp(scheduler) {
  const app = express();
  app.use(express.json());

  app.post("/api/reminders", async (request, response) => {
    try {
      response.status(201).json(await scheduler.create(request.body));
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  app.get("/api/reminders/:id", (request, response) => {
    const reminder = scheduler.get(request.params.id);
    if (!reminder)
      return response.status(404).json({ error: "Reminder not found" });
    return response.json(reminder);
  });

  app.patch("/api/reminders/:id", async (request, response) => {
    try {
      const reminder = await scheduler.edit(request.params.id, request.body);
      if (!reminder)
        return response.status(409).json({ error: "Reminder is not editable" });
      return response.json(reminder);
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
  });

  app.post("/api/reminders/:id/cancel", async (request, response) => {
    const reminder = await scheduler.cancel(request.params.id);
    if (!reminder)
      return response
        .status(409)
        .json({ error: "Reminder is not cancellable" });
    return response.json(reminder);
  });

  app.post("/api/tick", async (request, response) => {
    await scheduler.poll();
    return response.json({ ok: true });
  });

  return app;
}
