import { db } from "./db/index.js";
import { todosTable } from "./db/schema.js";
import { eq, ilike } from "drizzle-orm";
import readlineSync from "readline-sync";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
  let cleaned = response.replace(/```json\n/g, '')
                       .replace(/```\n/g, '')
                       .replace(/```/g, '')
                       .trim();
  
  if (!cleaned.startsWith('{')) {
    return JSON.stringify({
      type: "output",
      output: "I apologize, but I couldn't process that request. Could you please try again?"
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
    const content = await generateResponse(`${SYSTEM_PROMPT}\nUser Input: ${messageContent}\nResponse:`);
    
    try {
      const action = JSON.parse(content);
      
      if (action.type === "action") {
        const fn = tools[action.function];
        if (!fn) {
          console.error("Invalid function call:", action.function);
          return true;
        }

        console.log(`Executing ${action.function} with input:`, action.input);
        const observation = await fn(action.input);
        
        const observationContent = JSON.stringify({
          type: "observation",
          observation: observation,
        });
        
        const nextResponse = await generateResponse(`${SYSTEM_PROMPT}\nObservation: ${observationContent}\nResponse:`);
        const nextAction = JSON.parse(nextResponse);
        
        if (nextAction.type === "output") {
          console.log(`🤖: ${nextAction.output}`);
        }
        return true;
      } else if (action.type === "output") {
        console.log(`🤖: ${action.output}`);
        return true;
      }
      
      return true;
    } catch (e) {
      console.error("Error processing response:", e);
      console.log("Raw content:", content);
      return true;
    }
  } catch (e) {
    console.error("Error in message processing:", e);
    console.error(e.stack);
    return true;
  }
}

async function main() {
  try {
    console.log("🤖: Hello! I'm your AI Todo Assistant. How can I help you today?");
    
    while (true) {
      const query = readlineSync.question(">> ");
      await processMessage(query);
    }
  } catch (error) {
    console.error("Error in main:", error);
    console.error(error.stack);
  }
}

main().catch(console.error);