import {Request, Response} from 'express';
import {db, getDocData} from './database';
import {Timestamp} from '@google-cloud/firestore';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

interface RequestInfo {
    courseId: string;
    callbackUrl: string;
    userId:string;
    pricingPlanId:string;
}

export async function createCheckoutSession(req: Request, res: Response) {

    try {

        const info: RequestInfo = {
            courseId: req.body.courseId,
            pricingPlanId: req.body.pricingPlanId,
            callbackUrl: req.body.callbackUrl,
            userId: req["uid"]
        };

        if (!info.userId) {
            const message = 'User must be authenticated.';
            console.log(message);
            res.status(403).json({message});
            return;
        }

        const purchaseSession = await db.collection('purchaseSessions').doc();

        const checkoutSessionData: any = {
            status: 'ongoing',
            created: Timestamp.now(),
            userId: info.userId
        };

        if (info.courseId) {
            checkoutSessionData.courseId = info.courseId;
        }
        else {
            checkoutSessionData.pricingPlanId = info.pricingPlanId;
        }

        await purchaseSession.set(checkoutSessionData);

        const user = await getDocData(`users/${info.userId}`);

        let sessionConfig,
            stripeCustomerId = user ? user.stripeCustomerId : undefined;

        if (info.courseId) {
            const course = await getDocData(`courses/${info.courseId}`);
            sessionConfig = setupPurchaseCourseSession(info, course,
                purchaseSession.id, stripeCustomerId);
        }
        else if (info.pricingPlanId) {
            sessionConfig = setupSubscriptionSession(info, purchaseSession.id,
                stripeCustomerId, info.pricingPlanId);
        }

        console.log(sessionConfig);

        const session = await stripe.checkout.sessions.create(sessionConfig);

        res.status(200).json({
            stripeCheckoutSessionId: session.id,
            stripePublicKey: process.env.STRIPE_PUBLIC_KEY
        });

    } catch (error) {
        console.log('Unexpected error occurred while purchasing course: ', error);
        res.status(500).json({error: 'Could not initiate Stripe checkout session'});
    }

}

function setupSubscriptionSession(info: RequestInfo, sessionId: string,stripeCustomerId,
                                  pricingPlanId) {

    const config = setupBaseSessionConfig(info, sessionId, stripeCustomerId);

    config.subscription_data = {
      items: [{plan: pricingPlanId}]
    };

    return config;
}

function setupPurchaseCourseSession(info: RequestInfo, course, sessionId: string,
                                    stripeCustomerId:string) {
    const config = setupBaseSessionConfig(info, sessionId, stripeCustomerId);
    config.line_items = [
        {
            name: course.titles.description,
            description: course.titles.longDescription,
            amount: course.price * 100,
            currency: 'usd',
            quantity: 1
        }
    ];
    return config;
}


function setupBaseSessionConfig(info: RequestInfo, sessionId: string,
                                stripeCustomerId:string) {
    const config: any = {
        payment_method_types: ['card'],
        success_url: `${info.callbackUrl}/?purchaseResult=success&ongoingPurchaseSessionId=${sessionId}`,
        cancel_url: `${info.callbackUrl}/?purchaseResult=failed`,
        client_reference_id: sessionId
    };

    if (stripeCustomerId) {
        config.customer = stripeCustomerId;
    }

    return config;
}





