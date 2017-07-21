"use strict";

var bcrypt = require('bcrypt-as-promised');
var HASH_ROUNDS = 10;

// This is a helper function to map a flat post to nested post
function transformPost(post) {
    return {
        id: post.posts_id,
        title: post.posts_title,
        url: post.posts_url,
        createdAt: post.posts_createdAt,
        updatedAt: post.posts_updatedAt,
        voteScore: post.voteScore,
        numUpvotes: post.numUpvotes,
        numDownvotes: post.numDownvotes,

        user: {
            id: post.users_id,
            username: post.users_username,
            createdAt: post.users_createdAt,
            updatedAt: post.users_updatedAt
        },
        subreddit: {
            id: post.subreddits_id,
            name: post.subreddits_name,
            description: post.subreddits_description,
            createdAt: post.subreddits_createdAt,
            updatedAt: post.subreddits_updatedAt
        }
    };
}

class RedditAPI {
    constructor(conn) {
        this.conn = conn;
    }

    /*
    user should have username and password
     */
    createUser(user) {
        /*
         first we have to hash the password. we will learn about hashing next week.
         the goal of hashing is to store a digested version of the password from which
         it is infeasible to recover the original password, but which can still be used
         to assess with great confidence whether a provided password is the correct one or not
         */
        return bcrypt.hash(user.password, HASH_ROUNDS)
        .then(hashedPassword => {
            return this.conn.query('INSERT INTO users (username, password, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())', [user.username, hashedPassword]);
        })
        .then(result => {
            return result.insertId;
        })
        .catch(error => {
            // Special error handling for duplicate entry
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('A user with this username already exists');
            }
            else {
                throw error;
            }
        });
    }

    /*
    post should have userId, title, url, subredditId
     */
    createPost(post) {
        if (!post.subredditId) {
            return Promise.reject(new Error("There is no subreddit id"));
        }

        return this.conn.query(
            `
                INSERT INTO posts (userId, title, url, createdAt, updatedAt, subredditId)
                VALUES (?, ?, ?, NOW(), NOW(), ?)`,
            [post.userId, post.title, post.url, post.subredditId]
        )
        .then(result => {
            return result.insertId;
        });
    }

    getAllPosts(subredditId, sortingMethod) {
        /*
         strings delimited with ` are an ES2015 feature called "template strings".
         they are more powerful than what we are using them for here. one feature of
         template strings is that you can write them on multiple lines. if you try to
         skip a line in a single- or double-quoted string, you would get a syntax error.

         therefore template strings make it very easy to write SQL queries that span multiple
         lines without having to manually split the string line by line.
         */
        var extraSelectWhereString ="";
        var extraSelectOrderString ="";
        if (subredditId){
            extraSelectWhereString = ` WHERE p.subredditId= ? `;
        }

        if (sortingMethod === "top"){
            extraSelectOrderString = ` ORDER BY voteScore DESC `;
        }
        else if (sortingMethod === "hot"){
            extraSelectOrderString = ` ORDER BY (COALESCE(SUM(v.voteDirection), 0) / (NOW() - p.createdAt)) DESC `;
        }
        else {
            extraSelectOrderString = ` ORDER BY p.createdAt DESC `;
        }

        return this.conn.query(
            `
            SELECT
                p.id AS posts_id,
                p.title AS posts_title,
                p.url AS posts_url,
                p.createdAt AS posts_createdAt,
                p.updatedAt AS posts_updatedAt, 
                
                u.id AS users_id,
                u.username AS users_username,
                u.createdAt AS users_createdAt,
                u.updatedAt AS users_updatedAt,
                
                s.id AS subreddits_id,
                s.name AS subreddits_name,
                s.description AS subreddits_description,
                s.createdAt AS subreddits_createdAt,
                s.updatedAt AS subreddits_updatedAt,
                
                COALESCE(SUM(v.voteDirection), 0) AS voteScore,
                SUM(IF(v.voteDirection = 1, 1, 0)) AS numUpvotes,
                SUM(IF(v.voteDirection = -1, 1, 0)) AS numDownvotes
                
            FROM posts p
                JOIN users u ON p.userId = u.id
                JOIN subreddits s ON p.subredditId = s.id
                LEFT JOIN votes v ON p.id = v.postId
            
            ${extraSelectWhereString}
            
            GROUP BY p.id
            ${extraSelectOrderString}
            LIMIT 25`, [subredditId]
        )
        .then(function(posts) {
            // console.log("THIS IS THE POSTS");
            // console.log(posts);
            return posts.map(transformPost);
        });
    }

    // Similar to previous function, but retrieves one post by its ID
    getSinglePost(postId) {
        return this.conn.query(
            `
            SELECT
                p.id AS posts_id,
                p.title AS posts_title,
                p.url AS posts_url,
                p.createdAt AS posts_createdAt,
                p.updatedAt AS posts_updatedAt, 
                
                u.id AS users_id,
                u.username AS users_username,
                u.createdAt AS users_createdAt,
                u.updatedAt AS users_updatedAt,
                
                s.id AS subreddits_id,
                s.name AS subreddits_name,
                s.description AS subreddits_description,
                s.createdAt AS subreddits_createdAt,
                s.updatedAt AS subreddits_updatedAt,
                
                COALESCE(SUM(v.voteDirection), 0) AS voteScore,
                SUM(IF(v.voteDirection = 1, 1, 0)) AS numUpvotes,
                SUM(IF(v.voteDirection = -1, 1, 0)) AS numDownvotes
                
            FROM posts p
                JOIN users u ON p.userId = u.id
                JOIN subreddits s ON p.subredditId = s.id
                LEFT JOIN votes v ON p.id = v.postId
                
            WHERE p.id = ?`,
            [postId]
        )
        .then(function(posts) {
            if (posts.length === 0) {
                return null;
            }
            else {
                return transformPost(posts[0]);
            }
        });
    }

    /*
    subreddit should have name and optional description
     */
    createSubreddit(subreddit) {
        return this.conn.query(
            `INSERT INTO subreddits (name, description, createdAt, updatedAt)
            VALUES(?, ?, NOW(), NOW())`, [subreddit.name, subreddit.description])
        .then(function(result) {
            return result.insertId;
        })
        .catch(error => {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('A subreddit with this name already exists');
            }
            else {
                throw error;
            }
        });
    }

    getAllSubreddits() {
        return this.conn.query(`
            SELECT id, name, description, createdAt, updatedAt
            FROM subreddits ORDER BY createdAt DESC`
        );
    }

    /*
    vote must have postId, userId, voteDirection
     */
    createVote(vote) {
        if (vote.voteDirection !== 1 && vote.voteDirection !== -1 && vote.voteDirection !== 0) {
            return Promise.reject(new Error("voteDirection must be one of -1, 0, 1"));
        }

        return this.conn.query(`
            INSERT INTO votes (postId, userId, voteDirection, createdAt, updatedAt)
            VALUES (?, ?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE voteDirection = ?, updatedAt = NOW()`,
            [vote.postId, vote.userId, vote.voteDirection, vote.voteDirection]
        );

    }

    /*
    comment must have userId, postId, text
     */
    createComment(comment) {
        return this.conn.query(`
            INSERT INTO comments (userId, postId, text, createdAt, updatedAt)
            VALUES (?, ?, ?, NOW(), NOW())`,
            [comment.userId, comment.postId, comment.text]
        )
        .then(result => {
            return result.insertId;
        });
    }

    getCommentsForPost(postId) {
        return this.conn.query(`
            SELECT
                c.id as comments_id,
                c.text as comments_text,
                c.createdAt as comments_createdAt,
                c.updatedAt as comments_updatedAt,
                
                u.id as users_id,
                u.username as users_username
                
            FROM comments c
                JOIN users u ON c.userId = u.id
                
            WHERE c.postId = ?
            ORDER BY c.createdAt DESC
            LIMIT 25`,
            [postId]
        )
        .then(function(results) {
            return results.map(function(result) {
                return {
                    id: result.comments_id,
                    text: result.comments_text,
                    createdAt: result.comments_createdAt,
                    updatedAt: result.comments_updatedAt,

                    user: {
                        id: result.users_id,
                        username: result.users_username
                    }
                };
            });
        });
    }

    checkUserLogin(username, password) {
        // return Promise.reject(new Error("TODO: You have to implement the RedditAPI.checkUserLogin function."))

        /*
        Here are the steps you should follow:

            1. Find an entry in the users table corresponding to the input username
                a. If no user is found, make your promise throw an error "username or password incorrect".
                b. If you found a user, move to step 2
            2. Use the bcrypt.compare function to check if the database's hashed password matches the input password
                a. if it does, make your promise return the full user object minus the hashed password
                b. if it doesn't, make your promise throw an error "username or password incorrect"
         */
        // let userObj= {}; Alternative way instead of writing nested promise
        var resultGlobal;
        return this.conn.query(
            `
            SELECT 
                u.id        AS user_id,
                u.username  AS user_username,
                u.password  AS user_password,
                u.createdAt AS user_createdAt,
                u.updatedAt AS user_updatedAt
            
            FROM users u
            
            WHERE u.username = ?
            `, [username]

        )
            .then( function(result) {
                if (result.length === 0) {
                    return Promise.reject(new Error("username or password incorrect"));
                }
                // console.log("password param:" + password);

                //update the userObj by giving it key values from your query, non-nested method

                /*.then(username => bcrypt.compare(password, username))
                * .then(resultsBcrypt => {
                * if(true){//blah blah error handling blah}
                * })*/


                resultGlobal = result[0]; //re-assigning into object
                return bcrypt.compare(password, resultGlobal.user_password) //return a promise
            })
            .catch( function(err) {
                console.log(err);
                return Promise.reject(new Error("username or password incorrect"));
            })
            .then( function () {
                // console.log(result); //NB: we can use previously declared variables in parent functions like callbacks in promises!

                return {
                    id        : resultGlobal.user_id,
                    username  : resultGlobal.user_username,
                    createdAt : resultGlobal.user_createdAt,
                    updatedAt : resultGlobal.user_updatedAt
                };
            });
    }


    createUserSession(userId) {
        // return Promise.reject(new Error("TODO: You have to implement the RedditAPI.createUserSession function."))

        /*
         Here are the steps you should follow:

         1. Use bcrypt's genSalt function to create a random string that we'll use as session id (promise)
         2. Use an INSERT statement to add the new session to the sessions table, using the input userId
         3. Once the insert is successful, return the random session id generated in step 1
         */
        var resultSalt;
        var that=this; //Could also use an arrow function instead of this that
        return bcrypt.genSalt(HASH_ROUNDS)

            .then(function(_resultSalt){
                resultSalt = _resultSalt;
                return that.conn.query(
                    `
                    INSERT INTO sessions (userid, token)
                    VALUES (?, ?)
                    `, [userId, resultSalt]
                );
            })
            .then( function() {
                return resultSalt;
            });
    }


    getUserFromSession(sessionId) {
        // return Promise.reject(new Error("TODO: You have to implement the RedditAPI.getUserFromSession function."));
        return this.conn.query(
            `
            SELECT 
            users.id AS id, 
            users.username  AS username,
            users.createdAt AS createdAt,
            users.updatedAt AS updatedAt, 
            sessions.token AS sessionToken 
            FROM users 
            JOIN sessions 
            ON (users.id = sessions.userId)
            WHERE
            sessions.token = ?; 
            `, [sessionId]
        )
            .then( function(result){
                // console.log("RESULT:");
                // console.log(result[0]);
                result = result[0];
                return {
                    token : result.sessionToken,
                    id    : result.id,
                    username : result.username,
                    updatedAt : result.updatedAt,
                    createdAt : result.createdAt
                };
            });



    }

    getSubredditByName(name){
        return this.conn.query(
            `
            SELECT * FROM subreddits WHERE subreddits.name = ?
            `, [name]
        )
            .then( function(resultSet){

                if (resultSet.length === 0){
                    return null; //"If no subreddit was found, the promise should resolve with null."
                }

                return resultSet;
            });
    }

    deleteSessionFromTable(user){ //pass in a full user Object
        var userId = user.id;
        return this.conn.query(
            `
            DELETE FROM sessions WHERE userId=?
            `,[userId]
        )
            .then( function(resultSet){
                if( resultSet.affectedRows === 0){
                    return Promise.reject(new Error("Deletion not found!"));
                }
            })
    }

    getSubreddits(){
        return this.conn.query(
            `
            SELECT * FROM subreddits ORDER BY name ASC;
            `
        )
            .then(function(resultSet){
               if (resultSet.length === 0){
                   return Promise.reject(new Error("subreddit SQL query went wrong!"));
               }
               return resultSet;
            });
    }
}

module.exports = RedditAPI;