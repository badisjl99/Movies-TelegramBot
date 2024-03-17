const dotenv = require('dotenv');
const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const pm2 = require('pm2');

dotenv.config();

const token = process.env.BOT_API_TOKEN;
const uri = process.env.MONGO_URI;

async function connectToMongoDB() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        console.log('Connected to MongoDB');
        return client.db().collection('movies');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        process.exit(1);
    }
}

async function startBot() {
    try {
        const moviesCollection = await connectToMongoDB();
        
        const bot = new TelegramBot(token, { polling: { interval: 1000 } });
        bot.deleteWebHook();
        console.log('Bot is running...');

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            const username = msg.from.username;
            bot.sendMessage(chatId, `Hello ${username}, How may I help you today?`)
                .catch(error => console.error('Error:', error));
        });

        bot.onText(/\/about/, (msg) => {
            const chatId = msg.chat.id;
            const message = `🎬 Welcome to MovieMagnet! 🤖\n\nDiscover the latest blockbusters effortlessly. 🌟\nInstantly download your favorite movies in HD. 🎥\nStay ahead with our curated selection of the newest releases. 🍿\nExperience cinema at your fingertips with MovieMagnet! 🌟🤖`;
            bot.sendMessage(chatId, message);
        });

        bot.onText(/\/randommovie/, async (msg) => {
            const chatId = msg.chat.id;

            try {
                const moviesCollection = await connectToMongoDB();
                
                const randomMovies = await moviesCollection.aggregate([
                    { $match: { rating: { $gt: "7" }, year: { $gte: "2000" } } },
                    { $sample: { size: 1 } }
                ]).toArray();

                randomMovies.forEach(async movie => {
                    let summary = movie.summary;
                    if (summary.length > 270) {
                        summary = summary.substring(0, 270) + '...';
                    }

                    const genres = movie.genres.join(', ');
                    const actors = movie.actors.map(actor => `${actor.name} as ${actor.role}`).join('\n');

                    const trailerLink = `[🎬 Watch Trailer](${movie.trailerLink})`;

                    const message = `
🎬 *Title:*      *${movie.title}*\n
⭐️ *Rating:* ${movie.rating}
📅 *Year:* ${movie.year}
🎭 *Genres:* ${genres}
👤 *Actors:*
${actors}\n
📝 *Description:* ${summary}\n
 [${trailerLink}]
`;

                    const downloadButtons = movie.download.map(download => ({
                        text: `${download.quality}`,
                        url: download.link
                    }));

                    const inline_keyboard = downloadButtons.map(button => ([{ text: button.text, url: button.url }]));

                    await bot.sendPhoto(chatId, movie.imageUrl, {
                        caption: message,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: inline_keyboard
                        }
                    });
                });

                await moviesCollection.client.close();
            } catch (error) {
                console.error('Error:', error);
                bot.sendMessage(chatId, 'An error occurred while processing your request');
            }
        });

        bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            const message = `
🤖 *MovieMagnet Bot Help* 🤖\n\n
Use the following *commands* to interact with the bot:\n
/help - Display available commands and their descriptions.
/about - Learn more about MovieMagnet bot.
/randommovie - Get a random movie recommendation.
/displaygenres - Display all available genres.
/genre (Movie genre Choice) - Display Random Movie With Specified Genre (example : /genre crime) 
`;
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });

        bot.onText(/\/displaygenres/, async (msg) => {
            const chatId = msg.chat.id;

            try {
                const moviesCollection = await connectToMongoDB();
                const genres = await moviesCollection.distinct('genres');

                const message = `🎭 *Available Genres* 🎭\n\n${genres.join('\n')}`;
                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

                await moviesCollection.client.close();
            } catch (error) {
                console.error('Error:', error);
                bot.sendMessage(chatId, 'An error occurred while processing your request');
            }
        });

        bot.onText(/^\/genre (.+)$/, async (msg, match) => {
            const chatId = msg.chat.id;
            const genre = match[1].toLowerCase();

            try {
                const moviesCollection = await connectToMongoDB();
                
                const randomMovie = await moviesCollection.aggregate([
                    { $match: { genres: { $regex: new RegExp(genre, 'i') }, rating: { $gt: "7" }, year: { $gte: "2000" } } },
                    { $sample: { size: 1 } }
                ]).next();

                if (!randomMovie) {
                    bot.sendMessage(chatId, 'No movie found for the specified genre.');
                    return;
                }

                let summary = randomMovie.summary;
                if (summary.length > 270) {
                    summary = summary.substring(0, 270) + '...';
                }

                const genres = randomMovie.genres.join(', ');
                const actors = randomMovie.actors.map(actor => `${actor.name} as ${actor.role}`).join('\n');

                const trailerLink = `[🎬 Watch Trailer](${randomMovie.trailerLink})`;

                const message = `
🎬 *Title:*      *${randomMovie.title}*\n
⭐️ *Rating:* ${randomMovie.rating}
📅 *Year:* ${randomMovie.year}
🎭 *Genres:* ${genres}
👤 *Actors:*
${actors}\n
📝 *Description:* ${summary}\n
[${trailerLink}]
`;

                const downloadButtons = randomMovie.download.map(download => ({
                    text: `${download.quality}`,
                    url: download.link
                }));

                const inline_keyboard = downloadButtons.map(button => ([{ text: button.text, url: button.url }]));

                await bot.sendPhoto(chatId, randomMovie.imageUrl, {
                    caption: message,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: inline_keyboard
                    }
                });

                await moviesCollection.client.close();
            } catch (error) {
                console.error('Error:', error);
                bot.sendMessage(chatId, 'An error occurred while processing your request');
            }
        });

    } catch (error) {
        console.error('Error starting bot:', error);
        process.exit(1);
    }
}

pm2.connect((err) => {
    if (err) {
        console.error('Error connecting to PM2:', err);
        process.exit(1);
    }

    pm2.list((err, list) => {
        if (err) {
            console.error('Error retrieving PM2 process list:', err);
            pm2.disconnect();
            process.exit(1);
        }

        const botProcess = list.find((process) => process.name === 'telegram_bot');
        if (botProcess) {
            console.log('Bot process is already running with PID:', botProcess.pid);
            pm2.disconnect();
            process.exit(0);
        } else {
            startBot();
            pm2.disconnect();
        }
    });
});
