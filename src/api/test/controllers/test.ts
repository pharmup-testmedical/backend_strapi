/**
 * test controller
 */

import { factories } from '@strapi/strapi'

export default factories.createCoreController('api::test.test', ({ strapi }) => ({
    async submit(ctx: any) {
        try {
            const {
                testId,
                answers
            }: {
                testId: string;
                answers: { questionIndex: number; answer: string }[]; // Using questionIndex instead of questionId
            } = ctx.request.body

            // Validate input
            if (!testId) {
                throw new Error('ID теста обязателен')
            }
            if (!answers || !Array.isArray(answers) || answers.length === 0) {
                throw new Error('Ответы на вопросы обязательны')
            }

            const userId = ctx.state.user.id
            // strapi.log.info(`Received test submission from user with id: ${userId} for test: ${testId}`)

            // Fetch the test with all questions
            const test = await strapi.documents('api::test.test').findOne({
                documentId: testId,
                populate: {
                    questions: {
                        populate: {
                            multipleChoice: true
                        }
                    }
                }
            })

            if (!test) {
                throw new Error('Тест не найден')
            }

            // Log the test structure
            // strapi.log.info('Test questions:', JSON.stringify(test.questions.map((q: any) => ({
            //     index: test.questions.indexOf(q),
            //     question: q.question,
            //     correctAnswer: q.correctAnswer,
            //     options: q.multipleChoice?.map((opt: any) => opt.title)
            // })), null, 2))

            // Check if user has already completed this test
            const existingCompletion = await strapi.documents('api::completed-test.completed-test').findFirst({
                filters: {
                    test: {
                        documentId: testId
                    },
                    user: {
                        id: userId
                    }
                }
            })

            if (existingCompletion) {
                throw new Error('Вы уже прошли этот тест')
            }

            // Calculate score by comparing answers with correctAnswer field using question index
            const result = calculateTestScore(test.questions, answers)

            // Determine if passed (e.g., 80% correct)
            const passingScore = 100 // 80% to pass
            const passed = result.percentage >= passingScore

            if (!passed) {
                throw new Error(`Тест не пройден. Правильных ответов: ${result.correctCount} из ${result.totalCount} (${result.percentage}%)`)
            }

            // Get the test's cashback amount
            const cashback = test.cashback || 0

            // Create completed test record
            const completedTest = await strapi.documents('api::completed-test.completed-test').create({
                data: {
                    test: {
                        documentId: testId
                    },
                    user: {
                        id: userId
                    },
                    cashback
                },
                populate: {
                    test: true,
                    user: true
                }
            })

            strapi.log.info(`User ${userId} successfully completed test ${testId} with score ${result.percentage}% and earned ${cashback} cashback`)

            return ctx.send({
                success: true,
                data: {
                    completedTest,
                    result: {
                        ...result,
                        cashback,
                        passed
                    }
                }
            })

        } catch (error: any) {
            strapi.log.error(`Error processing test submission for user ${ctx.state.user.id}: ${error.message}`)
            return ctx.badRequest(error.message || 'Непредвиденная ошибка при отправке теста')
        }
    }
}))

// Helper function to calculate test score using question index/order
function calculateTestScore(questions: any[], userAnswers: { questionIndex: number; answer: string }[]) {
    let correctCount = 0
    const totalCount = questions.length
    const questionResults = []

    // strapi.log.info('Calculating score with questions count:', questions.length)
    // strapi.log.info('User answers:', JSON.stringify(userAnswers, null, 2))

    // Create a map for quick lookup of answers by index
    const answerMap = new Map()
    userAnswers.forEach(a => {
        answerMap.set(a.questionIndex, a.answer)
    })

    // Iterate through questions by their order/index
    questions.forEach((question, index) => {
        // strapi.log.info(`Processing question at index ${index}:`, {
        //     question: question.question,
        //     correctAnswer: question.correctAnswer
        // })

        // Find the answer by index
        const userAnswer = answerMap.get(index)

        // strapi.log.info(`Answer for index ${index}:`, userAnswer)

        if (!userAnswer) {
            strapi.log.info(`No answer found for question at index ${index}`)
            questionResults.push({
                questionIndex: index,
                correct: false,
                message: 'Вопрос не был отвечен'
            })
            return
        }

        // Compare with the correctAnswer field
        const isCorrect = userAnswer === question.correctAnswer

        if (isCorrect) {
            correctCount++
            // strapi.log.info(`Question at index ${index} is CORRECT`)
        } else {
            strapi.log.info(`Question at index ${index} is INCORRECT - Expected: "${question.correctAnswer}", Got: "${userAnswer}"`)
        }

        questionResults.push({
            questionIndex: index,
            correct: isCorrect,
            userAnswer: userAnswer,
            correctAnswer: question.correctAnswer
        })
    })

    const percentage = Math.round((correctCount / totalCount) * 100)

    return {
        correctCount,
        totalCount,
        percentage,
        questionResults
    }
}