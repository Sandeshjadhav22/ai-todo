import express from "express";
import cors from "cors";
import { db } from "./db/index.js";
import { todosTable } from "./db/schema.js";
import { eq, ilike } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI("GEMINI_API_KEY");

async function getAllTodos() {
  const todos = await db.select().from(todosTable);
  return todos;
}

async function createTodo(todo) {
  const [result] = await db
    .insert(todosTable)
    .values({
      todo,
    })
    .returning({
      id: todosTable.id,
    });
  return result.id;
}

async function deleteById(id) {
  await db.delete(todosTable).where(eq(todosTable.id, id));
}

async function searchTodo(search) {
  const todos = await db
    .select()
    .from(todosTable)
    .where(ilike(todosTable.todo, search));
  return todos;
}

const tools = {
  getAllTodos,
  createTodo,
  deleteById,
  searchTodo,
};

const SYSTEM_PROMPT = `
You are an AI Todo Assistant. For any task-related request, you MUST create an action to add it to the database.
DO NOT just respond with output - you must use the createTodo action.

Respond ONLY with JSON in these formats:

For new todos:
{"type": "action", "function": "createTodo", "input": "the todo text"}

For viewing todos:
{"type": "action", "function": "getAllTodos"}

For searching:
{"type": "action", "function": "searchTodo", "input": "search term"}

For deleting:
{"type": "action", "function": "deleteById", "input": "id"}

After actions, you'll get an observation with the result.
Then respond with:
{"type": "output", "output": "your message"}

For greetings/unclear requests, respond with:
{"type": "output", "output": "your helpful message asking what todo they want to add"}

Example interaction:
User: "Add a task to buy groceries"
Assistant: {"type": "action", "function": "createTodo", "input": "buy groceries"}
System: {"type": "observation", "observation": 1}
Assistant: {"type": "output", "output": "I've added 'buy groceries' to your todo list!"}

IMPORTANT: Always use createTodo for any task the user mentions. Return only JSON, no extra text.
`;

const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

function cleanResponse(response) {
  let cleaned = response
    .replace(/```json\n/g, "")
    .replace(/```\n/g, "")
    .replace(/```/g, "")
    .trim();

  if (!cleaned.startsWith("{")) {
    return JSON.stringify({
      type: "output",
      output:
        "I apologize, but I couldn't process that request. Could you please try again?",
    });
  }

  return cleaned;
}

async function generateResponse(prompt) {
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return cleanResponse(response.text());
  } catch (error) {
    console.error("Error generating response:", error);
    throw error;
  }
}

async function processMessage(userMessage) {
  try {
    const messageContent = JSON.stringify({ type: "user", user: userMessage });
    const content = await generateResponse(
      `${SYSTEM_PROMPT}\nUser Input: ${messageContent}\nResponse:`
    );

    try {
      const action = JSON.parse(content);

      if (action.type === "action") {
        const fn = tools[action.function];
        if (!fn) {
          throw new Error("Invalid function call: " + action.function);
        }

        const observation = await fn(action.input);
        const observationContent = JSON.stringify({
          type: "observation",
          observation: observation,
        });

        const nextResponse = await generateResponse(
          `${SYSTEM_PROMPT}\nObservation: ${observationContent}\nResponse:`
        );
        const nextAction = JSON.parse(nextResponse);

        if (nextAction.type === "output") {
          return {
            success: true,
            message: nextAction.output,
            action: action.function,
            result: observation,
          };
        }
      } else if (action.type === "output") {
        return {
          success: true,
          message: action.output,
        };
      }
    } catch (e) {
      console.error("Error processing response:", e);
      throw e;
    }
  } catch (e) {
    console.error("Error in message processing:", e);
    throw e;
  }
}

// AI Agent endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    const result = await processMessage(message);
    res.json(result);
  } catch (error) {
    console.error("Error processing request:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process request",
      details: error.message,
    });
  }
});

// Direct endpoints for CRUD operations
app.get("/api/todos", async (req, res) => {
  try {
    const todos = await getAllTodos();
    res.json({ success: true, todos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/todos", async (req, res) => {
  try {
    const { todo } = req.body;
    const id = await createTodo(todo);
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/todos/:id", async (req, res) => {
  try {
    await deleteById(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/todos/search", async (req, res) => {
  try {
    const { q } = req.query;
    const todos = await searchTodo(q);
    res.json({ success: true, todos });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
